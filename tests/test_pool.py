"""连接池测试：缓存、断线重试、错误映射。"""

from __future__ import annotations

import asyncio

import asyncssh
import pytest

from ssh_mcp.errors import CredentialConfigError, ServerNotFoundError, SshTimeoutError


@pytest.fixture
def pool(harness, make_mcp):
    gw = make_mcp()
    return gw.state.pool, gw.state

async def test_get_connection_caches(pool):
    pool_obj, state = pool
    conn1 = await pool_obj.get_connection("web-1")
    conn2 = await pool_obj.get_connection("web-1")
    assert conn1 is conn2
    assert len(state.pool._conns) == 1


async def test_unknown_alias_lists_available(pool):
    pool_obj, _ = pool
    with pytest.raises(ServerNotFoundError, match="web-1、db-1"):
        await pool_obj.get_connection("nope")


async def test_connect_failure_maps_to_friendly_error(pool, harness):
    pool_obj, _ = pool
    harness.fail_next_connect = OSError("connection refused")
    with pytest.raises(CredentialConfigError, match="web-1"):
        await pool_obj.get_connection("web-1")


async def test_connect_timeout_maps(pool, harness):
    pool_obj, _ = pool

    async def slow(**kwargs):
        await asyncio.sleep(0.05)
        raise asyncio.TimeoutError()  # 真实 asyncssh 在 connect_timeout 后抛出的异常

    import ssh_mcp.ssh.pool as pool_mod

    orig = pool_mod.asyncssh.connect
    pool_mod.asyncssh.connect = slow  # type: ignore
    try:
        with pytest.raises(SshTimeoutError):
            await pool_obj.get_connection("web-1")
    finally:
        pool_mod.asyncssh.connect = orig  # type: ignore


async def test_run_with_retry_reconnects_once(pool, harness):
    pool_obj, _ = pool
    await pool_obj.get_connection("web-1")
    calls = {"n": 0}

    class FlakyConn:
        async def run(self, command, check=False, encoding=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise asyncssh.ConnectionLost("connection reset")
            return ("ok", 0)

        def close(self):
            pass

    # 第一次操作时连接已被外部破坏：手动替换缓存里的连接
    pool_obj._conns["web-1"] = FlakyConn()

    def op(conn):
        return conn.run("uptime")

    result = await pool_obj.run_with_retry("web-1", op)
    # 失效重连后由新建的 FakeConn 接管执行成功（op 层不做解码，返回原始 bytes）
    assert result.stdout == b"ran: uptime\n"
    assert calls["n"] == 1  # FlakyConn 只被调用一次，之后被替换


async def test_channel_open_error_triggers_reconnect(pool, harness):
    """ChannelOpenError 必须触发失效重连（线上事故回归）。

    sshd 的 MaxSessions 打满后新 channel 会被拒，asyncssh 抛 ChannelOpenError。
    它不是 DisconnectError/ConnectionLost/OSError 的子类，曾被漏在 _RETRYABLE
    之外——坏连接永远留在池里反复失败，工具持续报错且无法自愈，
    表现为"SSH 一直断"（重连 ssh-mcp 容器才恢复）。
    """
    pool_obj, _ = pool
    await pool_obj.get_connection("web-1")
    calls = {"n": 0}

    class SessionExhaustedConn:
        async def run(self, command, check=False, encoding=None):
            calls["n"] += 1
            raise asyncssh.ChannelOpenError(2, "open failed")

        def close(self):
            pass

    pool_obj._conns["web-1"] = SessionExhaustedConn()

    def op(conn):
        return conn.run("uptime")

    # 旧连接抛 ChannelOpenError → 失效重连 → 新 FakeConn 执行成功
    result = await pool_obj.run_with_retry("web-1", op)
    assert result.stdout == b"ran: uptime\n"
    assert calls["n"] == 1
    # 坏连接确实被丢弃了
    assert not isinstance(pool_obj._conns.get("web-1"), SessionExhaustedConn)


async def test_channel_open_error_persistent_maps_readable(pool, harness):
    """通道持续打满：最终报错必须可读（而不是把 asyncssh 原文 mask 掉）。"""
    pool_obj, _ = pool

    class AlwaysDead:
        async def run(self, command, check=False, encoding=None):
            raise asyncssh.ChannelOpenError(2, "open failed")

        def close(self):
            pass

    harness.exec_behavior = lambda cmd, *a: AlwaysDead().run(cmd)
    pool_obj._conns["web-1"] = AlwaysDead()

    def op(conn):
        return conn.run("uptime")

    with pytest.raises(CredentialConfigError, match="重连后仍失败"):
        await pool_obj.run_with_retry("web-1", op)


@pytest.mark.parametrize(
    "exc_cls",
    [
        asyncssh.SFTPNoSuchFile,
        asyncssh.SFTPPermissionDenied,
        asyncssh.SFTPNoSpaceOnFilesystem,
        asyncssh.SFTPFileAlreadyExists,
    ],
)
async def test_deterministic_errors_are_not_retried(pool, exc_cls):
    """确定性错误（文件不存在/权限不足/磁盘满）不得触发重连重试。

    _RETRYABLE 曾一度收成 asyncssh.Error 全族——SFTPError 也在其中，
    于是这类错误会被无谓地重试一次（白等一轮连接超时），
    且报错被误改成"重连后仍失败"，掩盖真实原因。
    """
    pool_obj, _ = pool
    await pool_obj.get_connection("web-1")

    class DeterministicFail:
        async def run(self, command, check=False, encoding=None):
            raise exc_cls("deterministic failure")

        def close(self):
            pass

    pool_obj._conns["web-1"] = DeterministicFail()

    def op(conn):
        return conn.run("uptime")

    # 原样抛出该异常（不被包装成"重连后仍失败"），且缓存连接未被丢弃
    with pytest.raises(exc_cls):
        await pool_obj.run_with_retry("web-1", op)
    assert isinstance(pool_obj._conns.get("web-1"), DeterministicFail), (
        "确定性错误不该让连接失效重连"
    )


async def test_run_with_retry_second_failure_maps_error(pool, harness):
    pool_obj, _ = pool

    class DeadConn:
        async def run(self, command, check=False, encoding=None):
            raise asyncssh.ConnectionLost("down")

        def close(self):
            pass

    # 缓存里放"坏连接"，且让重连后的新连接同样抛错
    harness.exec_behavior = lambda cmd, *a: asyncssh.ConnectionLost("still down")
    pool_obj._conns["web-1"] = DeadConn()

    def op(conn):
        return conn.run("uptime")

    with pytest.raises(CredentialConfigError, match="重连后仍失败"):
        await pool_obj.run_with_retry("web-1", op)


async def test_close_all(pool):
    pool_obj, _ = pool
    await pool_obj.get_connection("web-1")
    await pool_obj.get_connection("db-1")
    await pool_obj.close_all()
    assert pool_obj._conns == {}
