"""FastMCP 的公开 token 验证扩展，每次请求读取当前持久化状态。"""

import asyncio
import math

from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_http_request

from .expiry import expiry_epoch
from .store import IdentityStore


class StoreTokenVerifier(TokenVerifier):
    def __init__(self, store: IdentityStore, audit=None):
        super().__init__()
        self.store = store
        self.audit = audit

    async def verify_token(self, token: str) -> AccessToken | None:
        item = await asyncio.to_thread(self.store.verify_token, token)
        if item is None:
            if self.audit is not None:
                known = await asyncio.to_thread(self.store.token_for_audit, token)
                record = {
                    "tool": "authentication",
                    "status": "denied",
                    "error": "MCP 凭证无效、未绑定空间、已停用、已删除或已到期",
                    "token_id": known["id"] if known else None,
                    "token_name": known["name"] if known else None,
                    "token_prefix": known["prefix"] if known else None,
                    "workspace_id": known["workspace_id"] if known else None,
                }
                workspace = (
                    await asyncio.to_thread(self.store.workspace_info, known["workspace_id"])
                    if known else None
                )
                record["workspace_name"] = workspace["name"] if workspace else None
                try:
                    request = get_http_request()
                    record["source_ip"] = request.client.host if request.client else None
                except RuntimeError:
                    pass
                await self.audit.log(record)
            return None
        return AccessToken(
            token=token,
            client_id=item["id"],
            scopes=[],
            expires_at=math.ceil(expiry_epoch(item["expires_at"])) if item["expires_at"] else None,
            claims={
                "token_id": item["id"],
                "token_name": item["name"],
                "token_prefix": item["prefix"],
                "workspace_id": item["workspace_id"],
            },
        )
