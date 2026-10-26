"""人员 Cookie 会话管理 API；MCP Bearer 凭证只在协议端点使用。"""

from __future__ import annotations

import asyncio
import csv
import hmac
import io
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any

import asyncssh
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response

from ..auth import IdentityError
from ..config import ConfigError, ServerEntry, expand_env_vars, sanitize_server_entry
from ..errors import SshMcpError
from ..state import GatewayState

_INDEX_HTML = Path(__file__).parent / "static" / "index.html"
_STATIC_DIR = Path(__file__).parent / "static"
_TEST_TIMEOUT = 15
_KEY_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_MAX_KEY_BYTES = 64 * 1024
_COOKIE = "ssh_mcp_session"


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


def _audit_filters(qp: Any) -> dict[str, Any]:
    kind = qp.get("kind", "mcp")
    if kind not in {"mcp", "person"}:
        raise IdentityError("审计类型须为 mcp 或 person")
    filters = {key: qp.get(key) or None for key in ("server", "status", "q", "token_id", "user_id")}
    filters["kind"] = kind
    if qp.get("since"):
        try:
            stamp = datetime.fromisoformat(qp["since"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError
            filters["since"] = stamp.astimezone(timezone.utc).isoformat(timespec="milliseconds")
        except ValueError:
            raise IdentityError("since 须为包含时区的 ISO 时间") from None
    if qp.get("days"):
        try:
            days = min(3650, max(1, int(qp["days"])))
        except ValueError:
            raise IdentityError("days 须为整数") from None
        filters["since"] = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(
            timespec="milliseconds"
        )
    return filters


def _csv_cell(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def register_web_routes(mcp: FastMCP, state: GatewayState) -> None:
    def event(
        request,
        action,
        *,
        user=None,
        status="ok",
        error=None,
        object_type=None,
        object_id=None,
        summary=None,
    ):
        return {
            "event_id": str(uuid.uuid4()),
            "actor_user_id": user["id"] if user else None,
            "username": user["username"]
            if user
            else getattr(request.state, "attempted_username", None),
            "action": action,
            "object_type": object_type,
            "object_id": object_id,
            "summary": summary,
            "status": status,
            "error": error,
            "request_id": getattr(request.state, "request_id", str(uuid.uuid4())),
            "source_ip": request.client.host if request.client else None,
        }

    async def read_body(request):
        try:
            value = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise IdentityError("请求体必须是 JSON 对象") from None
        if not isinstance(value, dict):
            raise IdentityError("请求体必须是 JSON 对象")
        return value

    def route(path, methods, *, action=None, public=False, object_type=None):
        def decorate(handler):
            @wraps(handler)
            async def wrapped(request):
                request.state.request_id = str(uuid.uuid4())
                request.state.user = None
                request.state.identity_event = None
                request.state.outbox_recorded = False
                if public and request.method == "POST":
                    content_type = request.headers.get("content-type", "").split(";", 1)[0]
                    if content_type != "application/json":
                        return JSONResponse({"detail": "请使用 application/json"}, status_code=400)
                if not public:
                    session = await asyncio.to_thread(
                        state.identity.session, request.cookies.get(_COOKIE)
                    )
                    if session is None:
                        if action:
                            await state.audit.log_person(
                                event(
                                    request,
                                    action,
                                    status="denied",
                                    error="网页登录认证失败",
                                    object_type=object_type,
                                )
                            )
                        return JSONResponse({"detail": "请使用用户名和密码登录"}, status_code=401)
                    request.state.user, request.state.csrf_token = session
                    if request.method not in {"GET", "HEAD"}:
                        csrf = request.headers.get("x-csrf-token", "")
                        if not hmac.compare_digest(session[1], csrf):
                            if action:
                                await state.audit.log_person(
                                    event(
                                        request,
                                        action,
                                        user=session[0],
                                        status="denied",
                                        error="CSRF校验失败",
                                        object_type=object_type,
                                    )
                                )
                            return JSONResponse(
                                {"detail": "CSRF 校验失败，请刷新页面"}, status_code=403
                            )
                record = (
                    event(
                        request,
                        action,
                        user=request.state.user,
                        object_type=object_type,
                        object_id=next(iter(request.path_params.values()), None),
                    )
                    if action
                    else None
                )
                request.state.identity_event = record
                external_audit = bool(action and action.startswith(("server.", "key.", "audit.")))
                if external_audit:
                    await state.audit.begin_person(record)
                try:
                    response = await handler(request)
                except asyncio.CancelledError:
                    if external_audit:
                        record.update(status="cancelled", error="请求取消，外部操作结果未知")
                        await state.audit.finish_person(record)
                    raise
                except IdentityError as exc:
                    response = JSONResponse({"detail": str(exc)}, status_code=400)
                except ConfigError:
                    # Pydantic validation messages can contain submitted secrets.
                    response = JSONResponse(
                        {"detail": "配置校验失败，请检查字段、环境变量与凭据类型"}, status_code=400
                    )
                except (OSError, ValueError, TypeError, KeyError):
                    response = JSONResponse(
                        {"detail": "操作失败，请检查输入、文件权限与服务日志"}, status_code=400
                    )
                except Exception as exc:  # noqa: BLE001 - keep audit and sanitized failure response
                    logging.getLogger(__name__).error("管理操作失败: %s", type(exc).__name__)
                    response = JSONResponse(
                        {"detail": "服务暂时无法完成操作，请稍后重试"}, status_code=500
                    )
                if record:
                    if response.status_code >= 400:
                        record["status"] = "error"
                        record["error"] = "操作未完成（请求被拒绝或参数无效）"
                    if (
                        getattr(request.state, "attempted_username", None)
                        and record["username"] is None
                    ):
                        record["username"] = request.state.attempted_username
                    # Identity mutations have a transactional outbox. Others are written directly.
                    if external_audit:
                        await state.audit.finish_person(record)
                    elif not getattr(request.state, "outbox_recorded", False):
                        await state.audit.log_person(record)
                    await state.flush_identity_events()
                response.headers["Cache-Control"] = "no-store"
                response.headers["X-Request-ID"] = request.state.request_id
                return response

            mcp.custom_route(path, methods=methods)(wrapped)
            return wrapped

        return decorate

    def set_session(response, value):
        auth = state.config.auth
        response.set_cookie(
            _COOKIE,
            value,
            max_age=auth.session_hours * 3600,
            httponly=True,
            secure=auth.cookie_secure,
            samesite="strict",
            path=auth.cookie_path,
        )

    @route("/", ["GET"], public=True)
    async def index(request):
        if not _INDEX_HTML.is_file():
            return JSONResponse({"detail": "前端产物缺失，请构建 webui"}, status_code=503)
        return FileResponse(_INDEX_HTML)

    @route("/assets/{path:path}", ["GET"], public=True)
    async def assets(request):
        file = (_STATIC_DIR / "assets" / request.path_params["path"]).resolve()
        if not file.is_relative_to((_STATIC_DIR / "assets").resolve()) or not file.is_file():
            return JSONResponse({"detail": "not found"}, status_code=404)
        return FileResponse(file)

    @route("/healthz", ["GET"], public=True)
    async def healthz(request):
        return JSONResponse({"ok": True})

    @route("/api/auth/status", ["GET"], public=True)
    async def auth_status(request):
        return JSONResponse(
            {"setup_required": await asyncio.to_thread(lambda: state.identity.setup_required)}
        )

    @route("/api/auth/setup", ["POST"], action="user.initialize", public=True, object_type="user")
    async def setup(request):
        value = await read_body(request)
        user = await asyncio.to_thread(
            state.identity.initialize,
            value.get("username", ""),
            value.get("password", ""),
            value.get("setup_key", ""),
            request.state.identity_event,
        )
        request.state.outbox_recorded = True
        request.state.user = user
        user, session, csrf = await asyncio.to_thread(
            state.identity.login, user["username"], value["password"]
        )
        response = JSONResponse({"user": user, "csrf_token": csrf}, status_code=201)
        set_session(response, session)
        return response

    @route("/api/auth/login", ["POST"], action="user.login", public=True, object_type="user")
    async def login(request):
        value = await read_body(request)
        username = value.get("username", "")
        username = username.strip() if isinstance(username, str) else username
        request.state.attempted_username = username[:128] if isinstance(username, str) else None
        if not isinstance(username, str) or not isinstance(value.get("password"), str):
            raise IdentityError("用户名或密码错误")
        try:
            user, session, csrf = await asyncio.to_thread(
                state.identity.login, username, value["password"], request.state.identity_event
            )
        except IdentityError:
            return JSONResponse({"detail": "用户名或密码错误"}, status_code=401)
        request.state.outbox_recorded = True
        response = JSONResponse({"user": user, "csrf_token": csrf})
        set_session(response, session)
        return response

    @route("/api/me", ["GET"])
    async def me(request):
        return JSONResponse({"user": request.state.user, "csrf_token": request.state.csrf_token})

    @route("/api/auth/logout", ["POST"], action="user.logout", object_type="session")
    async def logout(request):
        await asyncio.to_thread(
            state.identity.logout, request.cookies.get(_COOKIE, ""), request.state.identity_event
        )
        request.state.outbox_recorded = True
        response = JSONResponse({"ok": True})
        response.delete_cookie(_COOKIE, path=state.config.auth.cookie_path)
        return response

    @route("/api/users", ["GET"])
    async def list_users(request):
        return JSONResponse({"users": await asyncio.to_thread(state.identity.list_users)})

    @route("/api/users", ["POST"], action="user.create", object_type="user")
    async def create_user(request):
        value = await read_body(request)
        item = await asyncio.to_thread(
            state.identity.create_user,
            value.get("username", ""),
            value.get("password", ""),
            value.get("display_name", ""),
            request.state.identity_event,
        )
        request.state.outbox_recorded = True
        return JSONResponse(item, status_code=201)

    @route("/api/users/{id}", ["PATCH"], action="user.update", object_type="user")
    async def update_user(request):
        value = await read_body(request)
        changes = {k: v for k, v in value.items() if k in {"display_name", "password", "enabled"}}
        request.state.identity_event["summary"] = ", ".join(
            "密码已更换" if k == "password" else k for k in changes
        )
        item = await asyncio.to_thread(
            state.identity.update_user,
            request.path_params["id"],
            changes,
            request.state.identity_event,
        )
        request.state.outbox_recorded = True
        return JSONResponse(item)

    @route("/api/tokens", ["GET"])
    async def list_tokens(request):
        return JSONResponse({"tokens": await asyncio.to_thread(state.identity.list_tokens)})

    @route("/api/tokens", ["POST"], action="token.create", object_type="token")
    async def create_token(request):
        value = await read_body(request)
        token, item = await asyncio.to_thread(
            state.identity.create_token,
            value.get("name", ""),
            request.state.user["id"],
            value.get("description", ""),
            request.state.identity_event,
        )
        request.state.outbox_recorded = True
        return JSONResponse({"token": token, "item": item}, status_code=201)

    @route("/api/tokens/{id}", ["PATCH"], action="token.update", object_type="token")
    async def update_token(request):
        value = await read_body(request)
        changes = {k: v for k, v in value.items() if k in {"name", "description", "enabled"}}
        request.state.identity_event["summary"] = ", ".join(changes)
        item = await asyncio.to_thread(
            state.identity.update_token,
            request.path_params["id"],
            changes,
            request.state.identity_event,
        )
        request.state.outbox_recorded = True
        return JSONResponse(item)

    @route("/api/tokens/{id}", ["DELETE"], action="token.revoke", object_type="token")
    async def revoke_token(request):
        await asyncio.to_thread(
            state.identity.revoke_token, request.path_params["id"], request.state.identity_event
        )
        request.state.outbox_recorded = True
        return JSONResponse({"ok": True})

    @route("/api/servers", ["GET"])
    async def list_servers(request: Request) -> JSONResponse:
        return JSONResponse({"servers": [_server_payload(s) for s in state.config.servers]})

    # 注意：先注册 /api/servers/test，避免被 {alias} 路由吞掉
    @route("/api/servers/test", ["POST"], action="server.test", object_type="server")
    async def test_server(request: Request) -> JSONResponse:
        try:
            body = sanitize_server_entry(await read_body(request))
            request.state.identity_event["object_id"] = str(body.get("alias") or "")
            if "credential" not in body:
                # 编辑模式留空凭据：测试时沿用该服务器已保存的凭据
                existing = state.config.get_server(str(body.get("alias") or ""))
                if existing is not None:
                    body["credential"] = existing.credential
            entry = ServerEntry.model_validate(expand_env_vars(body))
        except ConfigError:
            return JSONResponse(
                {"ok": False, "error": "连接配置无效或无法连接，请检查地址、认证与网络"},
                status_code=400,
            )
        except Exception:  # noqa: BLE001 - 测试连接：把任何异常转成可读结果
            return JSONResponse(
                {"ok": False, "error": "配置无效，请检查字段与凭据类型"}, status_code=400
            )
        conn = None
        try:
            conn = await state.pool.connect_one_shot(entry)
            proc = await asyncio.wait_for(
                conn.run("echo ok", check=False, encoding=None), timeout=_TEST_TIMEOUT
            )
            ok = (proc.stdout or b"").strip() == b"ok"
            if not ok:
                request.state.identity_event["status"] = "error"
            message = "连接成功" if ok else "已连接但验证命令输出异常"
            return JSONResponse({"ok": ok, "message": message})
        except SshMcpError:
            request.state.identity_event["status"] = "error"
            return JSONResponse(
                {"ok": False, "error": "连接配置无效或无法连接，请检查地址、认证与网络"}
            )
        except Exception:  # noqa: BLE001 - 测试连接：把任何异常转成可读结果
            request.state.identity_event["status"] = "error"
            return JSONResponse({"ok": False, "error": "连接失败，请检查网络、地址与凭据"})
        finally:
            if conn is not None:
                conn.close()

    @route("/api/servers", ["POST"], action="server.create", object_type="server")
    async def create_server(request: Request) -> JSONResponse:
        try:
            body = await read_body(request)
            request.state.identity_event["object_id"] = str(body.get("alias") or "")
            request.state.identity_event["summary"] = "服务器配置已保存；凭据仅记录变更标记"
            config = await state.upsert_server(body)
        except ConfigError:
            return JSONResponse({"detail": "配置校验失败，请检查字段与环境变量"}, status_code=400)
        except OSError:
            # 权限不足 / 磁盘满 / 挂载不可写等：给出可读原因而不是 500
            return JSONResponse(
                {"detail": "配置文件写入失败，请检查目录权限与磁盘空间"}, status_code=500
            )
        return JSONResponse(
            _server_payload(config.get_server(str(body.get("alias")))), status_code=201
        )

    @route("/api/servers/{alias}", ["PUT"], action="server.update", object_type="server")
    async def update_server(request: Request) -> JSONResponse:
        alias = request.path_params["alias"]
        if state.config.get_server(alias) is None:
            return JSONResponse({"detail": f"服务器 {alias!r} 不存在"}, status_code=404)
        try:
            body = await read_body(request)
            body["alias"] = alias
            config = await state.upsert_server(body)
        except ConfigError:
            return JSONResponse({"detail": "配置校验失败，请检查字段与环境变量"}, status_code=400)
        except OSError:
            return JSONResponse(
                {"detail": "配置文件写入失败，请检查目录权限与磁盘空间"}, status_code=500
            )
        return JSONResponse(_server_payload(config.get_server(alias)))

    @route("/api/servers/{alias}", ["DELETE"], action="server.delete", object_type="server")
    async def delete_server(request: Request) -> JSONResponse:
        alias = request.path_params["alias"]
        if state.config.get_server(alias) is None:
            return JSONResponse({"detail": f"服务器 {alias!r} 不存在"}, status_code=404)
        try:
            await state.delete_server(alias)
        except OSError:
            return JSONResponse(
                {"detail": "配置文件写入失败，请检查目录权限与磁盘空间"}, status_code=500
            )
        return JSONResponse({"ok": True})

    @route("/api/keys", ["POST"], action="key.upload", object_type="key")
    async def upload_key(request: Request) -> JSONResponse:
        """上传 .pem 私钥到网关机 keys/ 目录，返回落盘路径供表单直接使用。"""
        body = await read_body(request)
        alias = str(body.get("alias") or "").strip()
        request.state.identity_event["object_id"] = alias
        request.state.identity_event["summary"] = "上传私钥（不记录内容）"
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
                return JSONResponse({"detail": "私钥无法解析，请检查格式或口令"}, status_code=400)
        except (asyncssh.KeyEncryptionError, ValueError):
            return JSONResponse({"detail": "私钥无法解析，请检查格式或口令"}, status_code=400)

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
        except OSError:
            return JSONResponse(
                {"detail": "密钥写入失败，请检查目录权限与磁盘空间"}, status_code=500
            )
        return JSONResponse({"path": str(target)})

    @route("/api/audit", ["GET"])
    async def audit_query(request):
        qp = request.query_params
        try:
            limit = min(max(1, int(qp.get("limit", "20"))), 200)
            offset = max(0, int(qp.get("offset", "0")))
        except ValueError:
            raise IdentityError("分页参数必须是整数") from None
        records, total = await asyncio.to_thread(
            state.audit.query, limit=limit, offset=offset, **_audit_filters(qp)
        )
        return JSONResponse({"records": records, "total": total, "limit": limit, "offset": offset})

    @route("/api/audit/export", ["GET"], action="audit.export", object_type="audit")
    async def audit_export(request):
        filters = _audit_filters(request.query_params)
        rows = await asyncio.to_thread(state.audit.export_rows, **filters)
        fields = (
            [
                "event_id",
                "ts",
                "actor_user_id",
                "username",
                "action",
                "object_type",
                "object_id",
                "summary",
                "status",
                "error",
                "request_id",
                "source_ip",
            ]
            if filters["kind"] == "person"
            else [
                "id",
                "ts",
                "token_id",
                "token_name",
                "token_prefix",
                "tool",
                "server",
                "target_host",
                "target_port",
                "target_username",
                "command",
                "path",
                "status",
                "duration_ms",
                "error",
                "request_id",
                "source_ip",
            ]
        )
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(fields)
        writer.writerows([_csv_cell(row.get(key)) for key in fields] for row in rows)
        return Response(
            "\ufeff" + buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="audit-{filters["kind"]}.csv"'},
        )
