"""命令行入口：加载配置并启动 HTTP MCP 服务。"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from .config import ConfigError, ConfigFile
from .server import create_mcp


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="ssh-mcp", description="团队共享 SSH 网关 MCP 服务"
    )
    parser.add_argument(
        "-c",
        "--config",
        default=os.environ.get("SSHMCP_CONFIG", "config.yaml"),
        help="配置文件路径（默认 ./config.yaml，可用 SSHMCP_CONFIG 覆盖）",
    )
    args = parser.parse_args()

    load_dotenv()
    path = Path(args.config)
    try:
        cfg_file = ConfigFile(path)
    except ConfigError as exc:
        print(f"配置错误: {exc}", file=sys.stderr)
        raise SystemExit(1) from None

    mcp, state = create_mcp(cfg_file)
    if state.config.auth.using_default_admin:
        print(
            "⚠️  未配置任何成员，已启用内置默认管理员账号 admin/admin。\n"
            "    请登录网页管理端，在「成员与 Token」中设置正式成员与 token。",
            file=sys.stderr,
        )
    mcp.run(
        transport="http",
        host=state.config.server.host,
        port=state.config.server.port,
    )


if __name__ == "__main__":
    main()
