"""审计：SQLite 存储 + 统一的工具调用中间件。

决策回顾：仅审计、不拦截。每次工具调用记一条，内容字段只记指纹与长度，
绝不记文件内容与凭据。默认只保留最近 30 天（retention_days 可配），
写入时顺带清理超期记录，避免日志无限增长。
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware, MiddlewareContext

_CONTENT_TOOLS = ("upload_file", "download_file")
_PRUNE_INTERVAL_SECONDS = 3600  # 清理节流：最多每小时一次

_FIELDS = (
    "ts",
    "user",
    "tool",
    "server",
    "command",
    "path",
    "request_id",
    "status",
    "duration_ms",
    "error",
    "content_bytes",
    "content_sha256",
)

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    {_FIELDS[0]}  TEXT NOT NULL,
    {_FIELDS[1]}  TEXT,
    {_FIELDS[2]}  TEXT,
    {_FIELDS[3]}  TEXT,
    {_FIELDS[4]}  TEXT,
    {_FIELDS[5]}  TEXT,
    {_FIELDS[6]}  TEXT,
    {_FIELDS[7]}  TEXT,
    {_FIELDS[8]}  REAL,
    {_FIELDS[9]}  TEXT,
    {_FIELDS[10]} INTEGER,
    {_FIELDS[11]} TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_records(ts);
CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_records(server);
"""

_INSERT_SQL = (
    f"INSERT INTO audit_records ({','.join(_FIELDS)}) "
    f"VALUES ({','.join('?' * len(_FIELDS))})"
)


def current_user() -> str:
    """当前认证用户（StaticTokenVerifier 的 client_id），取不到则为 anonymous。"""
    try:
        token = get_access_token()
        return token.client_id if token else "anonymous"
    except Exception:  # noqa: BLE001 - 审计兜底：任何认证上下文异常都记为 anonymous
        return "anonymous"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AuditLogger:
    """SQLite 审计日志：写入即落盘，按保留期自动清理，支持分页查询。"""

    def __init__(self, path: Path, retention_days: int = 30):
        self.path = Path(path)
        self.retention_days = max(1, retention_days)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._last_prune = 0.0
        self._conn: sqlite3.Connection | None = None
        with self._lock:
            self._prune(force=True)

    def _connection(self) -> sqlite3.Connection:
        """惰性建连：close 之后再次写入会自动重开（调用方需持有 self._lock）。"""
        if self._conn is None:
            # check_same_thread=False + 显式加锁：允许在事件循环线程与 to_thread 间共用连接
            conn = sqlite3.connect(self.path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.executescript(_SCHEMA)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.commit()
            self._conn = conn
        return self._conn

    async def log(self, record: dict[str, Any]) -> None:
        row = [record.get(name) for name in _FIELDS]
        with self._lock:
            self._connection().execute(_INSERT_SQL, row)
            self._connection().commit()
            self._prune()

    def _prune(self, force: bool = False) -> None:
        """删除超过保留期的记录；调用方需持有 self._lock。"""
        now = time.monotonic()
        if not force and now - self._last_prune < _PRUNE_INTERVAL_SECONDS:
            return
        cutoff = (_utc_now() - timedelta(days=self.retention_days)).isoformat(
            timespec="milliseconds"
        )
        conn = self._connection()
        conn.execute("DELETE FROM audit_records WHERE ts < ?", (cutoff,))
        conn.commit()
        self._last_prune = now

    def _filter_clause(
        self,
        server: str | None = None,
        status: str | None = None,
        q: str | None = None,
        since: str | None = None,
    ) -> tuple[str, list[Any]]:
        """构造 WHERE 子句：服务器 / 状态 / 关键词（命令·路径·工具·用户）/ 时间下界。"""
        where: list[str] = []
        params: list[Any] = []
        if server:
            where.append("server = ?")
            params.append(server)
        if status:
            where.append("status = ?")
            params.append(status)
        if since:
            where.append("ts >= ?")
            params.append(since)
        if q:
            like = f"%{q}%"
            where.append(
                "(command LIKE ? OR path LIKE ? OR tool LIKE ? OR user LIKE ? OR server LIKE ?)"
            )
            params.extend([like] * 5)
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        return clause, params

    def query(
        self,
        limit: int = 20,
        offset: int = 0,
        server: str | None = None,
        status: str | None = None,
        q: str | None = None,
        since: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """分页查询，返回 (记录, 总数)；记录按时间倒序（新 → 旧）。"""
        clause, params = self._filter_clause(server, status, q, since)
        with self._lock:
            conn = self._connection()
            total = conn.execute(
                f"SELECT COUNT(*) FROM audit_records{clause}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM audit_records{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
        # sqlite3.Row 迭代得到的是值而非键，必须显式取 .keys()
        records = [{k: row[k] for k in row.keys() if k != "id"} for row in rows]  # noqa: SIM118
        return records, total

    def export_rows(
        self,
        server: str | None = None,
        status: str | None = None,
        q: str | None = None,
        since: str | None = None,
        cap: int = 50_000,
    ) -> list[dict[str, Any]]:
        """导出用：按同样条件取全量（带上限保护），新 → 旧。"""
        clause, params = self._filter_clause(server, status, q, since)
        with self._lock:
            rows = self._connection().execute(
                f"SELECT * FROM audit_records{clause} ORDER BY id DESC LIMIT ?",
                [*params, cap],
            ).fetchall()
        return [{k: row[k] for k in row.keys() if k != "id"} for row in rows]  # noqa: SIM118

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


class AuditMiddleware(Middleware):
    """在 on_call_tool 钩子统一记录，一处覆盖所有工具（含未来新增）。"""

    def __init__(self, audit: AuditLogger):
        self._audit = audit

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        message = context.message
        args: dict[str, Any] = dict(message.arguments or {})
        record: dict[str, Any] = {
            "ts": _utc_now().isoformat(timespec="milliseconds"),
            "user": current_user(),
            "tool": message.name,
            "server": args.get("server"),
            "command": args.get("command"),
            "path": args.get("path"),
        }
        content = args.get("content")
        if message.name in _CONTENT_TOOLS and isinstance(content, str):
            data = content.encode("utf-8")
            record["content_bytes"] = len(data)
            record["content_sha256"] = hashlib.sha256(data).hexdigest()
        if context.fastmcp_context is not None:
            try:
                record["request_id"] = context.fastmcp_context.request_id
            except Exception:  # noqa: BLE001, S110 - 可选字段，尽力而为
                pass

        start = time.monotonic()
        try:
            result = await call_next(context)
        except Exception as exc:
            record["status"] = "error"
            record["error"] = f"{type(exc).__name__}: {exc}"
            raise
        else:
            record["status"] = "ok"
            return result
        finally:
            record["duration_ms"] = round((time.monotonic() - start) * 1000, 1)
            await self._audit.log(record)
