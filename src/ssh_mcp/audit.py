"""人员操作与 MCP 调用审计：独立身份、目标快照、30 天保留和旧记录兼容。"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import logging
import re
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastmcp.server.dependencies import get_access_token, get_http_request
from fastmcp.server.middleware import Middleware, MiddlewareContext

_LOG = logging.getLogger(__name__)
_MAX_TEXT = 16_384
_SECRET_KEYS = re.compile(
    r"password|passwd|passphrase|secret|private_key|authorization|^token$|session", re.IGNORECASE
)
_SECRET_ARG = re.compile(
    r"(?i)((?:--)?(?:password|passwd|passphrase|token|secret|api[_-]?key|authorization)"
    r"\s*(?:[:=]\s*|\s+))(?:\"[^\"]*\"|'[^']*'|[^\s;,]+)"
)
_CONTENT_TOOLS = ("upload_file", "download_file")
_CALL = contextvars.ContextVar("ssh_mcp_audit_call", default=None)

_MCP_FIELDS = (
    "id",
    "ts",
    "ended_at",
    "service_id",
    "user",
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
    "request_id",
    "source_ip",
    "status",
    "duration_ms",
    "error",
    "exit_code",
    "content_bytes",
    "content_sha256",
    "truncated",
    "legacy_id",
)
_PERSON_FIELDS = (
    "event_id",
    "ts",
    "service_id",
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
)
_SCHEMA = """
CREATE TABLE IF NOT EXISTS mcp_calls (
 id TEXT PRIMARY KEY, ts TEXT NOT NULL, ended_at TEXT, service_id TEXT,
 user TEXT, token_id TEXT, token_name TEXT, token_prefix TEXT,
 tool TEXT, server TEXT, target_host TEXT, target_port INTEGER, target_username TEXT,
 command TEXT, path TEXT, request_id TEXT, source_ip TEXT, status TEXT,
 duration_ms REAL, error TEXT, exit_code INTEGER, content_bytes INTEGER,
 content_sha256 TEXT, truncated INTEGER DEFAULT 0, legacy_id INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_calls_ts ON mcp_calls(ts);
CREATE INDEX IF NOT EXISTS idx_calls_token ON mcp_calls(token_id,ts);
CREATE INDEX IF NOT EXISTS idx_calls_server ON mcp_calls(server,ts);
CREATE TABLE IF NOT EXISTS person_events (
 event_id TEXT PRIMARY KEY, ts TEXT NOT NULL, service_id TEXT,
 actor_user_id TEXT, username TEXT, action TEXT, object_type TEXT, object_id TEXT,
 summary TEXT, status TEXT, error TEXT, request_id TEXT, source_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_person_ts ON person_events(ts);
CREATE INDEX IF NOT EXISTS idx_person_actor ON person_events(actor_user_id,ts);
CREATE TABLE IF NOT EXISTS mcp_attempts (
 call_id TEXT NOT NULL, attempt INTEGER NOT NULL, ts TEXT NOT NULL,
 ended_at TEXT, status TEXT, error TEXT, PRIMARY KEY(call_id,attempt)
);
CREATE TABLE IF NOT EXISTS audit_migrations (name TEXT PRIMARY KEY);
"""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _now() -> str:
    return _utc_now().isoformat(timespec="milliseconds")


def redact(value: Any, secrets: tuple[str, ...] = ()) -> Any:
    """清除已知凭据和常见命名字段；不宣称可识别任意命令中的业务敏感值。"""
    if isinstance(value, dict):
        return {
            str(k): "[已脱敏]" if _SECRET_KEYS.search(str(k)) else redact(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, secrets) for v in value]
    if not isinstance(value, str):
        return value
    text = value
    for secret in sorted(set(secrets), key=len, reverse=True):
        if secret:
            text = text.replace(secret, "[已脱敏]")
    return _SECRET_ARG.sub(r"\1[已脱敏]", text)


def current_user() -> str:
    try:
        token = get_access_token()
        return token.client_id if token else "anonymous"
    except Exception:  # noqa: BLE001 - optional request context
        return "anonymous"


class AuditLogger:
    def __init__(self, path: Path, retention_days: int = 30):
        self.path = Path(path)
        self.retention_days = max(1, retention_days)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        self._last_prune = 0.0
        # Startup errors are visible. Runtime writes must never replace a tool result.
        self.prune()
        with self._lock:
            conn = self._connection()
            conn.execute(
                "UPDATE mcp_calls SET status='unknown',error=? WHERE status='running'",
                ["服务重新启动时发现未完成调用；远端结果未知"],
            )
            conn.commit()

    def _connection(self) -> sqlite3.Connection:
        if self._conn is None:
            conn = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            try:
                conn.execute("PRAGMA busy_timeout=5000")
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.executescript(_SCHEMA)
                self._migrate_legacy(conn)
                conn.commit()
            except BaseException:
                conn.close()
                raise
            self._conn = conn
        return self._conn

    @staticmethod
    def _migrate_legacy(conn: sqlite3.Connection) -> None:
        migrated = conn.execute("SELECT 1 FROM audit_migrations WHERE name='legacy-v1'").fetchone()
        if migrated:
            return
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_records'"
        ).fetchone()
        if exists:
            for record in conn.execute("SELECT * FROM audit_records ORDER BY id").fetchall():
                row = dict(record)
                fields = {key: row.get(key) for key in _MCP_FIELDS}
                fields.update(id=f"legacy-{row['id']}", legacy_id=row["id"], service_id="ssh-mcp")
                fields["token_name"] = "历史记录（未记录 token 身份）"
                fields["token_id"] = None
                fields["status"] = row.get("status") or "unknown"
                conn.execute(
                    f"INSERT OR IGNORE INTO mcp_calls ({','.join(_MCP_FIELDS)}) "
                    f"VALUES ({','.join('?' for _ in _MCP_FIELDS)})",
                    [fields[key] for key in _MCP_FIELDS],
                )
        conn.execute("INSERT INTO audit_migrations(name) VALUES ('legacy-v1')")

    def _write(self, table: str, key: str, fields: tuple[str, ...], record: dict[str, Any]) -> None:
        updates = [name for name in fields if name != key and name in record]
        chosen = [name for name in fields if name in record]
        assignments = ",".join(f"{name}=excluded.{name}" for name in updates)
        conflict = "DO NOTHING" if table == "person_events" else f"DO UPDATE SET {assignments}"
        with self._lock:
            conn = self._connection()
            conn.execute(
                f"INSERT INTO {table} ({','.join(chosen)}) VALUES ({','.join('?' for _ in chosen)}) "
                f"ON CONFLICT({key}) {conflict}",
                [record[name] for name in chosen],
            )
            conn.commit()
            self._prune()

    async def _safe_write(self, operation: Callable[[], None]) -> bool:
        # Operations use stable primary keys. Cancellation fallback can race a worker safely.
        try:
            await asyncio.to_thread(operation)
            return True
        except asyncio.CancelledError:
            try:
                operation()
                return True
            except Exception as exc:  # noqa: BLE001 - audit cannot replace business outcome
                _LOG.error("审计取消兜底写入失败: %s", type(exc).__name__)
                return False
        except Exception as exc:  # noqa: BLE001 - audit cannot replace business outcome
            _LOG.error("审计写入失败: %s", type(exc).__name__)
            return False

    @staticmethod
    def _prepare(record: dict[str, Any], person: bool = False) -> dict[str, Any]:
        row = dict(record)
        row.setdefault("ts", _now())
        row.setdefault("service_id", "ssh-mcp")
        row.setdefault("event_id" if person else "id", uuid.uuid4().hex)
        for name in ("command", "path", "error", "summary"):
            if name not in row or row[name] is None:
                continue
            text = row[name]
            if isinstance(text, (dict, list)):
                text = json.dumps(redact(text), ensure_ascii=False)
            text = str(redact(str(text)))
            if len(text) > _MAX_TEXT:
                row["truncated"] = 1
            row[name] = text[:_MAX_TEXT]
        return row

    async def log(self, record: dict[str, Any]) -> None:
        """兼容旧调用；使用稳定 ID 幂等落库。"""
        row = self._prepare(record)
        await self._safe_write(lambda: self._write("mcp_calls", "id", _MCP_FIELDS, row))

    async def begin_call(self, record: dict[str, Any]) -> str:
        row = self._prepare({**record, "status": "running"})
        await self._safe_write(lambda: self._write("mcp_calls", "id", _MCP_FIELDS, row))
        return row["id"]

    async def finish_call(self, call_id: str, record: dict[str, Any]) -> None:
        row = self._prepare({**record, "id": call_id})
        row.setdefault("ended_at", _now())

        # Do not overwrite start timestamp when only completing an existing call.
        def complete():
            with self._lock:
                existing = (
                    self._connection()
                    .execute("SELECT ts FROM mcp_calls WHERE id=?", [call_id])
                    .fetchone()
                )
                if existing:
                    row["ts"] = existing["ts"]
                self._write("mcp_calls", "id", _MCP_FIELDS, row)

        await self._safe_write(complete)

    async def log_person(self, record: dict[str, Any]) -> bool:
        row = self._prepare(record, person=True)
        row.setdefault("username", row.get("actor_username"))
        return await self._safe_write(
            lambda: self._write("person_events", "event_id", _PERSON_FIELDS, row)
        )

    async def begin_person(self, record: dict[str, Any]) -> bool:
        """Persist a start marker before a non-transactional external side effect."""
        row = self._prepare({**record, "status": "running"}, person=True)
        return await self._safe_write(
            lambda: self._write("person_events", "event_id", _PERSON_FIELDS, row)
        )

    async def finish_person(self, record: dict[str, Any]) -> bool:
        """Complete only an existing start marker; never replace original timestamp."""
        row = self._prepare(record, person=True)
        fields = [key for key in _PERSON_FIELDS if key not in {"ts", "event_id"} and key in row]

        def complete():
            with self._lock:
                conn = self._connection()
                conn.execute(
                    "UPDATE person_events SET "
                    + ",".join(f"{key}=?" for key in fields)
                    + " WHERE event_id=? AND status='running'",
                    [row[key] for key in fields] + [row["event_id"]],
                )
                conn.commit()

        return await self._safe_write(complete)

    def _prune(self, force: bool = False) -> None:
        with self._lock:
            if not force and time.monotonic() - self._last_prune < 3600:
                return
            conn = self._connection()
            cutoff = (_utc_now() - timedelta(days=self.retention_days)).isoformat(
                timespec="milliseconds"
            )
            conn.execute(
                "DELETE FROM mcp_attempts WHERE call_id IN (SELECT id FROM mcp_calls WHERE ts < ?)",
                [cutoff],
            )
            conn.execute("DELETE FROM mcp_calls WHERE ts < ?", [cutoff])
            conn.execute("DELETE FROM person_events WHERE ts < ?", [cutoff])
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_records'"
            ).fetchone():
                conn.execute("DELETE FROM audit_records WHERE ts < ?", [cutoff])
            conn.commit()
            self._last_prune = time.monotonic()

    def prune(self) -> None:
        """Public maintenance entry point, callable even without new traffic."""
        self._prune(force=True)

    def _filter_clause(
        self, kind="mcp", server=None, status=None, q=None, since=None, token_id=None, user_id=None
    ):
        if kind not in ("mcp", "person"):
            raise ValueError("kind 必须是 mcp 或 person")
        cutoff = (_utc_now() - timedelta(days=self.retention_days)).isoformat(
            timespec="milliseconds"
        )
        where, params = ["ts >= ?"], [max(cutoff, since) if since else cutoff]
        filters = {"status": status}
        if kind == "mcp":
            filters.update(server=server, token_id=token_id)
            search = ("command", "path", "tool", "user", "server", "token_name", "target_host")
        else:
            filters.update(actor_user_id=user_id)
            search = ("username", "action", "object_type", "object_id", "summary")
        for key, value in filters.items():
            if value:
                where.append(f"{key} = ?")
                params.append(value)
        if q:
            where.append("(" + " OR ".join(f"{name} LIKE ?" for name in search) + ")")
            params.extend([f"%{q}%"] * len(search))
        return " WHERE " + " AND ".join(where), params

    def query(
        self,
        limit=20,
        offset=0,
        server=None,
        status=None,
        q=None,
        since=None,
        kind="mcp",
        token_id=None,
        user_id=None,
    ):
        clause, params = self._filter_clause(kind, server, status, q, since, token_id, user_id)
        table = "mcp_calls" if kind == "mcp" else "person_events"
        with self._lock:
            conn = self._connection()
            total = conn.execute(f"SELECT COUNT(*) FROM {table}{clause}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM {table}{clause} ORDER BY ts DESC,rowid DESC LIMIT ? OFFSET ?",
                [*params, max(1, min(int(limit), 50_000)), max(0, int(offset))],
            ).fetchall()
        return [dict(row) for row in rows], total

    def export_rows(
        self,
        server=None,
        status=None,
        q=None,
        since=None,
        cap=50_000,
        kind="mcp",
        token_id=None,
        user_id=None,
    ):
        return self.query(
            limit=cap,
            server=server,
            status=status,
            q=q,
            since=since,
            kind=kind,
            token_id=token_id,
            user_id=user_id,
        )[0]

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    async def attempt(self, call_id: str, attempt: int, status: str, error: str | None) -> None:
        def write():
            with self._lock:
                conn = self._connection()
                conn.execute(
                    "INSERT INTO mcp_attempts(call_id,attempt,ts,ended_at,status,error) VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(call_id,attempt) DO UPDATE SET ended_at=excluded.ended_at,status=excluded.status,error=excluded.error",
                    (
                        call_id,
                        attempt,
                        _now(),
                        None if status in ("running", "started") else _now(),
                        status,
                        redact(error)[:_MAX_TEXT] if error else None,
                    ),
                )
                conn.commit()

        await self._safe_write(write)


async def record_attempt(attempt: int, status: str, error: str | None = None) -> None:
    entry = _CALL.get()
    if entry:
        audit, call_id, secrets = entry
        await audit.attempt(call_id, attempt, status, redact(error, secrets) if error else None)


def _context_identity(state: Any) -> tuple[dict[str, Any], tuple[str, ...]]:
    identity = {"user": current_user()}
    secrets: list[str] = []
    try:
        token = get_access_token()
        if token:
            identity["token_id"] = token.client_id
            value = getattr(token, "token", None)
            if value:
                secrets.append(value)
            if state is not None:
                info = state.identity.token_info(token.client_id)
                if info:
                    identity.update(token_name=info.get("name"), token_prefix=info.get("prefix"))
    except Exception:  # noqa: BLE001 - optional identity enrichment
        _LOG.debug("认证上下文不可用")
    if state is not None:
        for server in state.config.servers:
            credential = server.credential
            for name in ("password", "passphrase", "private_key"):
                value = getattr(credential, name, None)
                if value is not None:
                    secrets.append(value.get_secret_value())
    return identity, tuple(secrets)


class AuditMiddleware(Middleware):
    def __init__(self, audit: AuditLogger, state: Any = None):
        self._audit = audit
        self._state = state

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        args = dict(context.message.arguments or {})
        identity, secrets = await asyncio.to_thread(_context_identity, self._state)
        record = {
            **identity,
            "ts": _now(),
            "tool": context.message.name,
            "server": args.get("server"),
            "command": redact(args.get("command"), secrets),
            "path": redact(args.get("path"), secrets),
        }
        if self._state is not None:
            target = self._state.config.get_server(str(args.get("server") or ""))
            if target:
                record.update(
                    target_host=target.host,
                    target_port=target.port,
                    target_username=target.username,
                )
        if context.fastmcp_context is not None:
            try:
                record["request_id"] = str(context.fastmcp_context.request_id)
            except Exception:  # noqa: BLE001 - optional request metadata
                _LOG.debug("请求编号不可用")
        if context.message.name in _CONTENT_TOOLS and isinstance(args.get("content"), str):
            content = args["content"].encode("utf-8")
            record.update(
                content_bytes=len(content), content_sha256=hashlib.sha256(content).hexdigest()
            )
        try:
            request = get_http_request()
            if request.client:
                record["source_ip"] = request.client.host
        except RuntimeError:
            pass
        started = time.monotonic()
        call_id = await self._audit.begin_call(record)
        scope = _CALL.set((self._audit, call_id, secrets))
        outcome: dict[str, Any] = {"status": "unknown"}
        try:
            task = asyncio.current_task()
            if task is not None and task.cancelling():
                raise asyncio.CancelledError()
            result = await call_next(context)
            outcome["status"] = "error" if getattr(result, "is_error", False) else "ok"
            structured = getattr(result, "structured_content", None)
            if isinstance(structured, dict):
                exit_code = structured.get("exit_code")
                if isinstance(exit_code, int):
                    outcome["exit_code"] = exit_code
                    if exit_code != 0:
                        outcome["status"] = "error"
                if structured.get("truncated"):
                    outcome["truncated"] = 1
            if outcome["status"] == "error":
                # Keep a bounded error summary without saving full successful output.
                parts = [getattr(block, "text", "") for block in getattr(result, "content", [])]
                outcome["error"] = redact(" ".join(parts)[:_MAX_TEXT], secrets)
            return result
        except asyncio.CancelledError:
            outcome.update(status="cancelled", error="请求已取消；远端操作是否完成需另行核实")
            raise
        except Exception as exc:
            status = "timeout" if "timeout" in type(exc).__name__.lower() else "error"
            outcome.update(status=status, error=redact(f"{type(exc).__name__}: {exc}", secrets))
            raise
        finally:
            _CALL.reset(scope)
            outcome["duration_ms"] = round((time.monotonic() - started) * 1000, 1)
            await self._audit.finish_call(call_id, outcome)
