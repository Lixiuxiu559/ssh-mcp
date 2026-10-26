"""FastMCP 的公开 token 验证扩展，每次请求读取当前持久化状态。"""

import asyncio

from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_http_request

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
                    "error": "MCP 凭证无效、已停用或已吊销",
                    "token_id": known["id"] if known else None,
                    "token_name": known["name"] if known else None,
                    "token_prefix": known["prefix"] if known else None,
                }
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
            claims={
                "token_id": item["id"],
                "token_name": item["name"],
                "token_prefix": item["prefix"],
            },
        )
