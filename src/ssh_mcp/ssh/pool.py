"""asyncssh 连接池：按 alias 缓存连接、断线失效重试一次、按服务器限流。

并发模型：所有工具跑在同一事件循环上，dict 读写本身安全；
真正需要保护的是"检查-再连接"竞态，用 per-alias 的 asyncio.Lock 双重检查解决。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import asyncssh

from ..audit import record_attempt
from ..config import (
    GatewayConfig,
    PasswordSpec,
    PrivateKeyFileSpec,
    PrivateKeyInlineSpec,
    ServerEntry,
)
from ..errors import CredentialConfigError, ServerNotFoundError, SshTimeoutError

T = TypeVar("T")

_CONNECT_TIMEOUT = 10
_KEEPALIVE_INTERVAL = 30
_KEEPALIVE_COUNT_MAX = 3

# 操作过程中出现这些异常视为"连接坏了"，失效重连再试一次。
#
# 为什么不是 asyncssh.Error 全族：SFTPError 也是它的子类，其下 30 个错误里
# 绝大多数是**确定性失败**（SFTPNoSpaceOnFilesystem / SFTPPermissionDenied /
# SFTPFileAlreadyExists …），重试毫无意义，还会白等一轮连接超时并掩盖真实原因。
#
# 为什么要显式收 ChannelOpenError：它不是 DisconnectError/ConnectionLost/OSError
# 的子类（只继承 asyncssh.Error），sshd 的 MaxSessions 打满后新 channel 被拒时
# 抛的就是它。曾被漏掉，导致坏连接永远留在池里反复失败——表现为"SSH 一直断、
# 重启容器才恢复"（2026-09-17 线上事故）。
_RETRYABLE = (
    asyncssh.ChannelOpenError,  # 通道被拒（MaxSessions 打满等）
    asyncssh.DisconnectError,  # 含 ConnectionLost / PermissionDenied / HostKeyNotVerifiable
    asyncssh.ConnectionLost,
    asyncssh.SFTPConnectionLost,  # SFTP 会话层断开
    asyncssh.SFTPNoConnection,  # SFTP 已无连接
    OSError,  # 网络层错误（连接被重置、EPIPE 等）
)


class ConnectionPool:
    def __init__(self, config_fn: Callable[[], GatewayConfig]):
        self._config_fn = config_fn
        self._conns: dict[str, Any] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._sems: dict[str, asyncio.Semaphore] = {}

    # ------------------------------------------------------------ 内部

    def _entry(self, alias: str) -> ServerEntry:
        entry = self._config_fn().get_server(alias)
        if entry is None:
            raise ServerNotFoundError(alias, [s.alias for s in self._config_fn().servers])
        return entry

    def _lock(self, alias: str) -> asyncio.Lock:
        if alias not in self._locks:
            self._locks[alias] = asyncio.Lock()
        return self._locks[alias]

    def _semaphore(self, alias: str) -> asyncio.Semaphore:
        if alias not in self._sems:
            limit = max(1, self._config_fn().limits.max_sessions_per_server)
            self._sems[alias] = asyncio.Semaphore(limit)
        return self._sems[alias]

    def _connect_kwargs(self, entry: ServerEntry) -> dict[str, Any]:
        cred = entry.credential
        kwargs: dict[str, Any] = {
            "host": entry.host,
            "port": entry.port,
            "username": entry.username,
            # None 表示跳过主机指纹校验（内网场景的可接受风险，README 有说明）
            "known_hosts": entry.known_hosts,
            "connect_timeout": _CONNECT_TIMEOUT,
            "keepalive_interval": _KEEPALIVE_INTERVAL,
            "keepalive_count_max": _KEEPALIVE_COUNT_MAX,
        }
        if isinstance(cred, PrivateKeyFileSpec):
            kwargs["client_keys"] = [cred.path]
            if cred.passphrase is not None:
                kwargs["passphrase"] = cred.passphrase.get_secret_value()
        elif isinstance(cred, PrivateKeyInlineSpec):
            key = asyncssh.import_private_key(
                cred.private_key.get_secret_value(),
                cred.passphrase.get_secret_value() if cred.passphrase else None,
            )
            kwargs["client_keys"] = [key]
        elif isinstance(cred, PasswordSpec):
            kwargs["password"] = cred.password.get_secret_value()
        return kwargs

    async def _connect(self, entry: ServerEntry) -> Any:
        try:
            return await asyncssh.connect(**self._connect_kwargs(entry))
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise SshTimeoutError(
                f"连接 {entry.alias}({entry.host}:{entry.port}) 超时（{_CONNECT_TIMEOUT}s），"
                "请确认网络可达后重试"
            ) from exc
        except (asyncssh.Error, OSError) as exc:
            raise CredentialConfigError(
                f"连接 {entry.alias}({entry.host}:{entry.port}) 失败: {exc}"
            ) from exc

    # ------------------------------------------------------------ 对外

    async def get_connection(self, alias: str) -> Any:
        """取缓存连接，没有则新建。连接失败直接抛 ToolError 子类，不重试。"""
        entry = self._entry(alias)
        async with self._lock(alias):
            conn = self._conns.get(alias)
            if conn is not None:
                return conn
            conn = await self._connect(entry)
            self._conns[alias] = conn
            return conn

    async def connect_one_shot(self, entry: ServerEntry) -> Any:
        """新建一次性连接（不缓存），供"测试连接"使用。"""
        return await self._connect(entry)

    def invalidate(self, alias: str) -> None:
        conn = self._conns.pop(alias, None)
        if conn is not None:
            conn.close()

    async def close_all(self) -> None:
        for alias in list(self._conns):
            self.invalidate(alias)

    async def run_with_retry(self, alias: str, op: Callable[[Any], Awaitable[T]]) -> T:
        """在缓存连接上执行操作；遇连接级错误则失效重连再试一次。

        只对 `_RETRYABLE`（连接级）重试。确定性错误（文件不存在、权限不足等）
        会直接抛出——它们已被工具层翻译成领域异常，重试无意义。
        """
        async with self._semaphore(alias):
            conn = await self.get_connection(alias)
            await record_attempt(1, "started")
            try:
                result = await op(conn)
            except _RETRYABLE as exc:
                await record_attempt(1, "error", str(exc))
                self.invalidate(alias)
                conn = await self.get_connection(alias)
                await record_attempt(2, "started")
                try:
                    result = await op(conn)
                except BaseException as exc2:
                    await record_attempt(2, "error", str(exc2))
                    if isinstance(exc2, _RETRYABLE):
                        raise CredentialConfigError(
                            f"在 {alias} 上操作失败（重连后仍失败）: {exc2}"
                        ) from exc2
                    raise
                await record_attempt(2, "ok")
                return result
            except BaseException as exc:
                await record_attempt(1, "error", str(exc))
                raise
            await record_attempt(1, "ok")
            return result
