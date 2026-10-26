"""FastMCP 依赖注入：把 GatewayState 注入工具函数。"""

from __future__ import annotations

from fastmcp import Context
from fastmcp.dependencies import CurrentContext

from .state import GatewayState


def get_state(ctx: Context = CurrentContext()) -> GatewayState:
    return ctx.lifespan_context["state"]
