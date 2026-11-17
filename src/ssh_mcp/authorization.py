"""每次调用与每次远端尝试都根据当前 Token、空间及设备归属授权。"""

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any

from fastmcp.server.dependencies import get_access_token

from .auth.expiry import is_expired
from .errors import AuthorizationError

if TYPE_CHECKING:
    from .config import ServerEntry
    from .state import GatewayState

# Bind target coordinates to the audited call, never a shared mutable "current workspace".
REQUEST_TARGETS: ContextVar[dict[str, Any] | None] = ContextVar("ssh_request_targets", default=None)


async def current_token(state: GatewayState) -> dict[str, Any]:
    token = get_access_token()
    info = (
        await asyncio.to_thread(state.identity.active_token_info, token.client_id)
        if token else None
    )
    if info is None or is_expired(info["expires_at"]):
        raise AuthorizationError("MCP Token 无效、已到期或未绑定可用空间，请联系后台管理人员")
    return info


async def visible_servers(state: GatewayState) -> list[ServerEntry]:
    workspace_id = (await current_token(state))["workspace_id"]
    # Configuration may change while SQLite runs. Resolve membership on the event
    # loop after that await, rather than returning an entry captured by a worker.
    return [entry for entry in state.config.servers if workspace_id in entry.workspace_ids]


async def authorize_server(state: GatewayState, alias: str) -> ServerEntry:
    entries = await visible_servers(state)
    for entry in entries:
        if entry.alias == alias:
            snapshots = REQUEST_TARGETS.get()
            if snapshots is not None and snapshots.get(alias) != entry.model_dump(
                exclude={"workspace_ids"}
            ):
                raise AuthorizationError("服务器配置已变更，请重新调用工具")
            return entry
    candidates = "、".join(entry.alias for entry in entries) or "（当前空间没有可用服务器）"
    raise AuthorizationError(
        f"服务器 {alias!r} 不存在或不属于当前空间。可用服务器: {candidates}。"
        "可先调用 list_servers 查看。"
    )
