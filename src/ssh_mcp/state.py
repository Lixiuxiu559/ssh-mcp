"""运行时共享状态：配置 + 连接池 + 审计日志。

网页修改配置后调用 upsert_server/delete_server，替换内存配置并失效受影响的
连接池条目，工具下一次调用即生效，无需重启。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .audit import AuditLogger
from .auth import IdentityStore
from .auth.store import WorkspaceConflict
from .authorization import authorize_server
from .config import ConfigError, ConfigFile, GatewayConfig, ServerEntry
from .ssh.pool import ConnectionPool


def _entry_signature(entry: ServerEntry) -> Any:
    """校验后的配置快照（已插值），用于判断凭据/主机信息是否变化。"""
    return entry.model_dump(exclude={"workspace_ids"})


async def _finish_locked(operation):
    """请求取消后仍等写入和内存发布结束，避免提前释放配置锁。"""
    task = asyncio.create_task(operation)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    result = task.result()
    if cancelled:
        raise asyncio.CancelledError()
    return result


class GatewayState:
    def __init__(self, cfg_file: ConfigFile):
        self._cfg_file = cfg_file
        self._config = cfg_file.load()
        self.audit = AuditLogger(
            self._config.audit.path,
            retention_days=self._config.audit.retention_days,
        )
        identity_path = self._config.auth.database
        if not identity_path.is_absolute():
            identity_path = cfg_file.path.resolve().parent / identity_path
        self.identity = IdentityStore(identity_path, self._config.auth.session_hours)
        self.identity.ensure_default_account()
        if any(
            self.identity.workspace_info(workspace_id) is None
            for entry in self._config.servers for workspace_id in entry.workspace_ids
        ):
            raise ConfigError("服务器引用了不存在的空间，请检查 workspace_ids")
        self._maintenance_task: asyncio.Task | None = None
        self.pool = ConnectionPool(self._get_config, lambda alias: authorize_server(self, alias))
        self._lock = asyncio.Lock()

    def _get_config(self) -> GatewayConfig:
        return self._config

    @property
    def config(self) -> GatewayConfig:
        return self._config

    @property
    def cfg_file(self) -> ConfigFile:
        return self._cfg_file

    def replace_config(self, config: GatewayConfig) -> None:
        """配置文件被整体替换后刷新内存态；连接池经由 _get_config 感知新配置。"""
        self._config = config

    async def upsert_server(
        self, entry: dict[str, Any], event: dict[str, Any] | None = None
    ) -> GatewayConfig:
        async with self._lock:
            ids = entry.get("workspace_ids", [])
            if not isinstance(ids, list) or any(not isinstance(item, str) for item in ids):
                raise ConfigError("workspace_ids 必须为存在的空间标识列表")
            workspace_names = {}
            if ids or event is not None:
                workspaces = await asyncio.to_thread(self.identity.list_workspaces)
                workspace_names = {workspace["id"]: workspace["name"] for workspace in workspaces}
                if set(ids) - workspace_names.keys():
                    raise ConfigError("workspace_ids 必须为存在的空间标识列表")
            alias = str(entry.get("alias") or "")
            return await _finish_locked(
                self._publish_server(
                    self._cfg_file.upsert_server, alias, entry,
                    event=event, workspace_names=workspace_names,
                )
            )

    async def delete_workspace(self, workspace_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            if any(workspace_id in entry.workspace_ids for entry in self.config.servers):
                raise WorkspaceConflict("空间仍有关联服务器，请先移除服务器归属")
            await _finish_locked(
                asyncio.to_thread(self.identity.delete_workspace, workspace_id, event)
            )

    async def delete_server(self, alias: str) -> GatewayConfig:
        async with self._lock:
            return await _finish_locked(
                self._publish_server(self._cfg_file.delete_server, alias, alias)
            )

    async def _publish_server(
        self, write, alias, entry, *, event=None, workspace_names=None
    ) -> GatewayConfig:
        old = self._config.get_server(alias)
        config = await asyncio.to_thread(write, entry)
        self._config = config
        new = config.get_server(alias)
        if old is not None and (
            new is None or _entry_signature(old) != _entry_signature(new)
        ):
            self.pool.invalidate(alias)
        if event is not None and new is not None:
            def summary(ids):
                return "、".join(
                    f"{workspace_names.get(wid, '未知空间')} ({wid})" for wid in ids
                ) or "无空间"

            before = summary(old.workspace_ids if old else [])
            after = summary(new.workspace_ids)
            event["summary"] = (
                f"服务器配置已保存；空间 {before} → {after}；凭据仅记录变更标记"
            )
        return config

    async def flush_identity_events(self) -> None:
        try:
            pending = await asyncio.to_thread(self.identity.pending_events)
            for event_id, record in pending:
                result = await self.audit.log_person(record)
                if result is False:
                    break
                await asyncio.to_thread(self.identity.acknowledge_event, event_id)
        except Exception:
            logging.getLogger(__name__).exception("人员审计投递失败，保留待重试事件")

    async def _maintenance(self) -> None:
        while True:
            try:
                await self.flush_identity_events()
                await asyncio.to_thread(self.audit.prune)
            except Exception:
                logging.getLogger(__name__).exception("身份审计维护失败，将于下一周期重试")
            await asyncio.sleep(60)

    async def startup(self) -> None:
        if self._maintenance_task is None or self._maintenance_task.done():
            self._maintenance_task = asyncio.create_task(self._maintenance())

    async def shutdown(self) -> None:
        if self._maintenance_task is not None:
            self._maintenance_task.cancel()
            try:
                await self._maintenance_task
            except asyncio.CancelledError:
                pass
            self._maintenance_task = None
        await self.flush_identity_events()
        await self.pool.close_all()
        self.audit.close()
        self.identity.close()
