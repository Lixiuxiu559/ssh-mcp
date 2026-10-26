"""FastMCP 服务组装：认证、生命周期、中间件、工具与网页路由。"""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.server.auth import StaticTokenVerifier
from fastmcp.server.lifespan import lifespan

from .audit import AuditMiddleware
from .config import ConfigFile, GatewayConfig
from .state import GatewayState
from .tools import exec_tool, files, inventory
from .web.api import register_web_routes


def build_token_verifier(config: GatewayConfig) -> StaticTokenVerifier:
    """token -> 用户名 的静态映射，MCP 请求凭 Bearer token 认证。"""
    tokens = {
        user.token.get_secret_value(): {"client_id": user.username}
        for user in config.auth.users
    }
    return StaticTokenVerifier(tokens=tokens)


def create_mcp(cfg_file: ConfigFile) -> tuple[FastMCP, GatewayState]:
    state = GatewayState(cfg_file)

    @lifespan
    async def _app_lifespan(server: FastMCP):
        yield {"state": state}
        await state.shutdown()

    mcp = FastMCP(
        name="ssh-mcp",
        instructions=(
            "团队共享 SSH 网关，可操作多台已配置的远端 Linux 服务器。\n"
            "流程：先用 list_servers 获取服务器别名（alias），之后所有工具都用 alias 指定服务器：\n"
            "- 执行命令: exec_command（远端为 Linux shell）\n"
            "- 浏览/读取文件: list_dir / read_file（仅 UTF-8 文本，二进制用 download_file）\n"
            "- 上传/下载文件: upload_file / download_file（内容经参数传输，有大小上限）\n"
            "- 健康状态: server_health\n"
            "注意：覆盖远端文件前建议先 read_file 备份；命令超时会被中断（nohup 除外）。"
        ),
        auth=build_token_verifier(state.config),
        lifespan=_app_lifespan,
        mask_error_details=True,
    )
    mcp.add_middleware(AuditMiddleware(state.audit))
    inventory.register(mcp)
    exec_tool.register(mcp)
    files.register(mcp)
    register_web_routes(mcp, state)
    return mcp, state
