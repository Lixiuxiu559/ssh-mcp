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
from .config import ConfigFile, GatewayConfig, ServerEntry
from .ssh.pool import ConnectionPool


def _entry_signature(entry: ServerEntry) -> Any:
    """校验后的配置快照（已插值），用于判断凭据/主机信息是否变化。"""
    return entry.model_dump()


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
        self.identity.migrate_legacy(self._config.auth.users)
        self._maintenance_task: asyncio.Task | None = None
        self.pool = ConnectionPool(self._get_config)
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

    async def upsert_server(self, entry: dict[str, Any]) -> GatewayConfig:
        async with self._lock:
            old = self._config.get_server(str(entry.get("alias") or ""))
            config = await asyncio.to_thread(self._cfg_file.upsert_server, entry)
            self._config = config
            new = config.get_server(str(entry["alias"]))
            if (
                old is not None
                and new is not None
                and _entry_signature(old) != _entry_signature(new)
            ):
                self.pool.invalidate(old.alias)
        return config

    async def delete_server(self, alias: str) -> GatewayConfig:
        async with self._lock:
            config = await asyncio.to_thread(self._cfg_file.delete_server, alias)
            self._config = config
            self.pool.invalidate(alias)
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
