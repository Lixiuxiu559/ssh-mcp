"""命令行入口：加载配置并启动 HTTP MCP 服务。"""

from __future__ import annotations

import argparse
import os
import sys
from importlib.resources import files
from pathlib import Path

from dotenv import load_dotenv

from . import __version__
from .config import ConfigError, ConfigFile
from .server import create_mcp


def main() -> None:
    parser = argparse.ArgumentParser(prog="ssh-mcp", description="团队共享 SSH 网关 MCP 服务")
    parser.add_argument("--version", action="version", version=f"ssh-mcp {__version__}")
    parser.add_argument(
        "-c",
        "--config",
        default=os.environ.get("SSHMCP_CONFIG", "config.yaml"),
        help="配置文件路径（默认 ./config.yaml，可用 SSHMCP_CONFIG 覆盖）",
    )
    parser.add_argument("--init", action="store_true", help="创建最小配置后退出（不覆盖已有文件）")
    parser.add_argument("--data-dir", type=Path, help="覆盖身份与审计的持久化运行目录")
    parser.add_argument("--host", help="覆盖监听地址，本地默认 127.0.0.1")
    parser.add_argument("--port", type=int, help="覆盖监听端口")
    args = parser.parse_args()

    load_dotenv()
    path = Path(args.config).expanduser().resolve()
    if args.init:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as output:
                os.chmod(path, 0o600)
                output.write(files("ssh_mcp").joinpath("default_config.yaml").read_text("utf-8"))
        except FileExistsError:
            message = "配置已存在，未覆盖" if path.exists() else "无法创建配置，请检查父路径和目录权限"
            print(f"{message}: {path}", file=sys.stderr)
            raise SystemExit(1) from None
        except OSError:
            print(f"无法创建配置，请检查目录权限和磁盘空间: {path}", file=sys.stderr)
            raise SystemExit(1) from None
        print(f"已创建配置: {path}\n启动命令: ssh-mcp --config {path}")
        return
    try:
        cfg_file = ConfigFile(path)
        if args.data_dir:
            data_root = args.data_dir.expanduser().resolve()
            cfg_file.raw.setdefault("auth", {})["database"] = str(data_root / "service.db")
            cfg_file.raw.setdefault("audit", {})["path"] = str(data_root / "audit" / "audit.db")
        if args.host is not None:
            cfg_file.raw.setdefault("server", {})["host"] = args.host
        if args.port is not None:
            if not 1 <= args.port <= 65535:
                raise ConfigError("端口必须在 1–65535 之间")
            cfg_file.raw.setdefault("server", {})["port"] = args.port
        mcp, state = create_mcp(cfg_file)
    except ConfigError as exc:
        print(f"配置错误: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
    except OSError:
        print("无法打开运行数据，请检查配置路径、目录权限与磁盘空间", file=sys.stderr)
        raise SystemExit(1) from None

    if state.identity.setup_required:
        print(
            "尚未创建登录账号。请在管理页设置用户名与密码，\n"
            f"一次性初始化码请从本机文件读取: {state.identity.setup_key_path}",
            file=sys.stderr,
        )
    mcp.run(
        transport="http",
        host=state.config.server.host,
        port=state.config.server.port,
    )


if __name__ == "__main__":
    main()
