"""网页管理端 API：服务器配置 CRUD、连接测试、审计查询、成员 token 管理。

- 鉴权与 MCP 共用同一套用户 token（Authorization: Bearer <token>）
- 管理页面仅 admin 可进入；写操作与成员管理要求 admin 标志
- 凭据值只写不读：servers CRUD 与成员接口永不返回 token 明文，
  保存时留空 = 保留原值（含 ${ENV} 引用）
"""

from __future__ import annotations

import asyncio
import csv
import hmac
import io
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncssh
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response

from ..config import ConfigError, ServerEntry, expand_env_vars, sanitize_server_entry
from ..errors import SshMcpError
from ..state import GatewayState

_INDEX_HTML = Path(__file__).parent / "static" / "index.html"
_STATIC_DIR = Path(__file__).parent / "static"
_TEST_TIMEOUT = 15
_KEY_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_MAX_KEY_BYTES = 64 * 1024


def _server_payload(entry: ServerEntry) -> dict[str, Any]:
    return {
        "alias": entry.alias,
        "host": entry.host,
        "port": entry.port,
        "username": entry.username,
        "description": entry.description,
        "tags": entry.tags,
        "credential_type": entry.credential.type,
        "has_known_hosts": entry.known_hosts is not None,
    }


def _audit_filters(query_params: Any) -> dict[str, Any]:
    """从查询串提取审计筛选条件：server / status / q（关键词）/ days（时间范围）。"""
    filters: dict[str, Any] = {
        "server": query_params.get("server") or None,
        "status": query_params.get("status") or None,
        "q": (query_params.get("q") or "").strip() or None,
    }
    days = query_params.get("days")
    if days:
        try:
            n = max(1, int(days))
            filters["since"] = (datetime.now(timezone.utc) - timedelta(days=n)).isoformat(
                timespec="milliseconds"
            )
        except ValueError:
            pass
    return filters


def _csv_cell(value: Any) -> Any:
    """防 CSV 公式注入：以 = + - @ 开头的单元格加前缀，避免在 Excel 中被当公式执行。"""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def register_web_routes(mcp: FastMCP, state: GatewayState) -> None:
    def authenticate(request: Request) -> tuple[Any, JSONResponse | None]:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            return None, JSONResponse({"detail": "未提供 token"}, status_code=401)
        token = header[7:].strip()
        for user in state.config.auth.users:
            if hmac.compare_digest(user.token.get_secret_value(), token):
                return user, None
        return None, JSONResponse({"detail": "token 无效"}, status_code=401)

    def require_admin(request: Request) -> tuple[Any, JSONResponse | None]:
        user, error = authenticate(request)
        if error is not None:
            return None, error
        if not user.admin:
            return None, JSONResponse({"detail": "需要 admin 权限"}, status_code=403)
        return user, None

    @mcp.custom_route("/", methods=["GET"])
    async def index(request: Request) -> FileResponse:
        return FileResponse(_INDEX_HTML)

    @mcp.custom_route("/assets/{path:path}", methods=["GET"])
    async def assets(request: Request) -> FileResponse | JSONResponse:
        rel = request.path_params["path"]
        file = (_STATIC_DIR / "assets" / rel).resolve()
        if not file.is_relative_to(_STATIC_DIR.resolve()) or not file.is_file():
            return JSONResponse({"detail": "not found"}, status_code=404)
        return FileResponse(file)

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    @mcp.custom_route("/api/me", methods=["GET"])
    async def me(request: Request) -> JSONResponse:
        user, error = authenticate(request)
        if error is not None:
            return error
        return JSONResponse(
            {
                "username": user.username,
                "admin": user.admin,
                "default_admin": state.config.auth.using_default_admin,
            }
        )

    @mcp.custom_route("/api/servers", methods=["GET"])
    async def list_servers(request: Request) -> JSONResponse:
        _, error = authenticate(request)
        if error is not None:
            return error
        return JSONResponse({"servers": [_server_payload(s) for s in state.config.servers]})

    # 注意：先注册 /api/servers/test，避免被 {alias} 路由吞掉
    @mcp.custom_route("/api/servers/test", methods=["POST"])
    async def test_server(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        try:
            body = sanitize_server_entry(await request.json())
            if "credential" not in body:
                # 编辑模式留空凭据：测试时沿用该服务器已保存的凭据
                existing = state.config.get_server(str(body.get("alias") or ""))
                if existing is not None:
                    body["credential"] = existing.credential
            entry = ServerEntry.model_validate(expand_env_vars(body))
        except ConfigError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
        except Exception as exc:  # noqa: BLE001 - 测试连接：把任何异常转成可读结果
            return JSONResponse(
                {"ok": False, "error": f"配置无效: {exc}"}, status_code=400
            )
        conn = None
        try:
            conn = await state.pool.connect_one_shot(entry)
            proc = await asyncio.wait_for(
                conn.run("echo ok", check=False, encoding=None), timeout=_TEST_TIMEOUT
            )
            ok = (proc.stdout or b"").strip() == b"ok"
            message = "连接成功" if ok else "已连接但验证命令输出异常"
            return JSONResponse({"ok": ok, "message": message})
        except SshMcpError as exc:
            return JSONResponse({"ok": False, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - 测试连接：把任何异常转成可读结果
            return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            if conn is not None:
                conn.close()

    @mcp.custom_route("/api/servers", methods=["POST"])
    async def create_server(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        try:
            body = await request.json()
            config = await state.upsert_server(body)
        except ConfigError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=400)
        except OSError as exc:
            # 权限不足 / 磁盘满 / 挂载不可写等：给出可读原因而不是 500
            return JSONResponse({"detail": f"配置文件写入失败: {exc}"}, status_code=500)
        return JSONResponse(
            _server_payload(config.get_server(str(body.get("alias")))), status_code=201
        )

    @mcp.custom_route("/api/servers/{alias}", methods=["PUT"])
    async def update_server(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        alias = request.path_params["alias"]
        if state.config.get_server(alias) is None:
            return JSONResponse({"detail": f"服务器 {alias!r} 不存在"}, status_code=404)
        try:
            body = await request.json()
            body["alias"] = alias
            config = await state.upsert_server(body)
        except ConfigError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=400)
        except OSError as exc:
            return JSONResponse({"detail": f"配置文件写入失败: {exc}"}, status_code=500)
        return JSONResponse(_server_payload(config.get_server(alias)))

    @mcp.custom_route("/api/servers/{alias}", methods=["DELETE"])
    async def delete_server(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        alias = request.path_params["alias"]
        if state.config.get_server(alias) is None:
            return JSONResponse({"detail": f"服务器 {alias!r} 不存在"}, status_code=404)
        try:
            await state.delete_server(alias)
        except OSError as exc:
            return JSONResponse({"detail": f"配置文件写入失败: {exc}"}, status_code=500)
        return JSONResponse({"ok": True})

    @mcp.custom_route("/api/audit", methods=["GET"])
    async def audit_query(request: Request) -> JSONResponse:
        _, error = authenticate(request)
        if error is not None:
            return error
        qp = request.query_params
        try:
            limit = min(max(1, int(qp.get("limit", "20"))), 200)
        except ValueError:
            limit = 20
        try:
            offset = max(0, int(qp.get("offset", "0")))
        except ValueError:
            offset = 0
        filters = _audit_filters(qp)
        records, total = state.audit.query(limit=limit, offset=offset, **filters)
        return JSONResponse(
            {"records": records, "total": total, "limit": limit, "offset": offset}
        )

    @mcp.custom_route("/api/audit/export", methods=["GET"])
    async def audit_export(request: Request) -> Response:
        _, error = authenticate(request)
        if error is not None:
            return error
        rows = state.audit.export_rows(**_audit_filters(request.query_params))
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "ts", "user", "tool", "server", "status", "duration_ms",
                "command", "path", "error", "request_id",
                "content_bytes", "content_sha256",
            ]
        )
        for r in rows:
            writer.writerow([_csv_cell(r.get(k)) for k in (
                "ts", "user", "tool", "server", "status", "duration_ms",
                "command", "path", "error", "request_id",
                "content_bytes", "content_sha256",
            )])
        # BOM 让 Excel 正确识别 UTF-8 中文
        body = "﻿" + buf.getvalue()
        filename = f"audit-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.csv"
        return Response(
            body,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @mcp.custom_route("/api/keys", methods=["POST"])
    async def upload_key(request: Request) -> JSONResponse:
        """上传 .pem 私钥到网关机 keys/ 目录，返回落盘路径供表单直接使用。"""
        _, error = require_admin(request)
        if error is not None:
            return error
        body = await request.json()
        alias = str(body.get("alias") or "").strip()
        content = body.get("content")
        if not _KEY_NAME_RE.match(alias):
            return JSONResponse(
                {"detail": "请先填写合法的别名（仅字母/数字/下划线/连字符），用作密钥文件名"},
                status_code=400,
            )
        if not isinstance(content, str) or "PRIVATE KEY" not in content:
            return JSONResponse({"detail": "不是有效的 PEM 私钥内容"}, status_code=400)
        if len(content.encode("utf-8")) > _MAX_KEY_BYTES:
            return JSONResponse({"detail": "私钥文件过大（上限 64KB）"}, status_code=400)
        # 预校验：能被 asyncssh 解析（无口令或加密均可）；完全非法直接拒绝
        try:
            asyncssh.import_private_key(content, None)
        except asyncssh.KeyImportError as exc:
            if "assphrase" not in str(exc):  # 加密私钥需要口令，属正常情况
                return JSONResponse({"detail": f"私钥无法解析: {exc}"}, status_code=400)
        except (asyncssh.KeyEncryptionError, ValueError) as exc:
            return JSONResponse({"detail": f"私钥无法解析: {exc}"}, status_code=400)

        key_dir = state.cfg_file.path.parent / "keys"
        target = (key_dir / f"{alias}.pem").resolve()
        if not target.is_relative_to(key_dir.resolve()):
            return JSONResponse({"detail": "非法路径"}, status_code=400)

        def _store() -> None:
            key_dir.mkdir(parents=True, exist_ok=True)
            os.chmod(key_dir, 0o700)
            target.write_text(content, encoding="utf-8")
            os.chmod(target, 0o600)

        try:
            await asyncio.to_thread(_store)
        except OSError as exc:
            return JSONResponse({"detail": f"密钥写入失败: {exc}"}, status_code=500)
        return JSONResponse({"path": str(target)})

    @mcp.custom_route("/api/users", methods=["GET"])
    async def list_users(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        # 返回 token 配置原文：${ENV} 引用显示引用本身，不展开真实值
        raw_users = state.cfg_file.raw.get("auth", {}).get("users", [])
        if raw_users:
            users = [
                {
                    "username": str(u.get("username") or ""),
                    "admin": bool(u.get("admin")),
                    "token": str(u.get("token") or ""),
                }
                for u in raw_users
            ]
        else:
            # 配置里还没写 auth（使用内置默认账号）：展示当前生效的成员，便于直接改名/换 token
            users = [
                {
                    "username": u.username,
                    "admin": u.admin,
                    "token": u.token.get_secret_value(),
                }
                for u in state.config.auth.users
            ]
        return JSONResponse({"users": users})

    @mcp.custom_route("/api/users", methods=["PUT"])
    async def update_users(request: Request) -> JSONResponse:
        _, error = require_admin(request)
        if error is not None:
            return error
        body = await request.json()
        users = body.get("users")
        if not isinstance(users, list):
            return JSONResponse({"detail": "users 应为列表"}, status_code=400)
        try:
            config = await asyncio.to_thread(state.cfg_file.update_users, users)
        except ConfigError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=400)
        except OSError as exc:
            return JSONResponse({"detail": f"配置文件写入失败: {exc}"}, status_code=500)
        except Exception as exc:  # noqa: BLE001 - 用户管理：任何异常转成可读错误
            return JSONResponse({"detail": f"保存失败: {exc}"}, status_code=400)
        state.replace_config(config)
        return JSONResponse({"ok": True})
