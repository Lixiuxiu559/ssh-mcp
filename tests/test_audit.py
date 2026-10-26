"""双审计、身份追溯、旧记录、取消与磁盘故障回归。"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastmcp import Client
from fastmcp.tools import ToolResult

from ssh_mcp import audit as audit_module
from ssh_mcp.audit import AuditLogger, AuditMiddleware, record_attempt, redact


def past(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="milliseconds")


@pytest.fixture
def audit(tmp_path):
    logger = AuditLogger(tmp_path / "audit.db")
    yield logger
    logger.close()


def context(command="uptime"):
    return SimpleNamespace(
        message=SimpleNamespace(
            name="exec_command", arguments={"server": "web-1", "command": command}
        ),
        fastmcp_context=SimpleNamespace(request_id="request-1"),
    )


async def test_audit_records_tool_calls(gw):
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "uptime"})
        await client.call_tool(
            "exec_command", {"server": "nope", "command": "ls"}, raise_on_error=False
        )
    rows, total = gw.state.audit.query()
    assert total == 2
    ok = next(row for row in rows if row["server"] == "web-1")
    error = next(row for row in rows if row["server"] == "nope")
    assert ok["status"] == "ok"
    assert ok["user"] == "anonymous"
    assert ok["token_id"] is None
    assert ok["target_host"] == gw.state.config.get_server("web-1").host
    assert ok["duration_ms"] >= 0 and ok["ended_at"]
    assert error["status"] == "error"
    assert "ServerNotFoundError" in error["error"]


async def test_audit_does_not_record_file_content(gw, harness):
    harness.fs_dirs = {"/", "/tmp"}
    async with Client(gw.mcp) as client:
        await client.call_tool(
            "upload_file", {"server": "web-1", "path": "/tmp/x.sh", "content": "SECRET-CONTENT-123"}
        )
    rows, _ = gw.state.audit.query()
    row = rows[0]
    assert row["content_bytes"] == len("SECRET-CONTENT-123")
    assert row["content_sha256"]
    assert "SECRET-CONTENT-123" not in json.dumps(rows)


async def test_token_snapshot_and_secret_redaction(audit, monkeypatch):
    token = SimpleNamespace(client_id="token-stable-1", token="mcp-actual-secret")
    monkeypatch.setattr(audit_module, "get_access_token", lambda: token)
    target = SimpleNamespace(
        host="10.2.3.4",
        port=2222,
        username="deploy",
        credential=SimpleNamespace(
            password=SimpleNamespace(get_secret_value=lambda: "target-password")
        ),
    )
    state = SimpleNamespace(
        identity=SimpleNamespace(token_info=lambda _: {"name": "ci-runner", "prefix": "mcp_abc"}),
        config=SimpleNamespace(get_server=lambda _: target, servers=[target]),
    )
    middleware = AuditMiddleware(audit, state)

    async def invoke(_):
        rows, _ = audit.query()
        assert rows[0]["status"] == "running" and rows[0]["ended_at"] is None
        return ToolResult(structured_content={"exit_code": 0})

    await middleware.on_call_tool(
        context("echo target-password; curl --token mcp-actual-secret"), invoke
    )
    rows, _ = audit.query()
    row = rows[0]
    assert (row["token_id"], row["token_name"], row["token_prefix"]) == (
        "token-stable-1",
        "ci-runner",
        "mcp_abc",
    )
    assert (row["target_host"], row["target_port"], row["target_username"]) == (
        "10.2.3.4",
        2222,
        "deploy",
    )
    assert row["exit_code"] == 0
    assert "target-password" not in row["command"] and "mcp-actual-secret" not in row["command"]
    target.host = "10.9.9.9"
    assert audit.query()[0][0]["target_host"] == "10.2.3.4"


async def test_legacy_records_migrate_once_without_inventing_token(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE audit_records(id INTEGER PRIMARY KEY,ts TEXT,user TEXT,tool TEXT,server TEXT,command TEXT,status TEXT)"
        )
        conn.execute(
            "INSERT INTO audit_records VALUES(1,?,'old-user','exec_command','web-1','whoami','ok')",
            [past(1)],
        )
    for _ in range(2):
        logger = AuditLogger(path)
        rows, total = logger.query()
        assert total == 1
        assert rows[0]["user"] == "old-user"
        assert rows[0]["token_id"] is None and rows[0]["legacy_id"] == 1
        assert rows[0]["command"] == "whoami"
        logger.close()


async def test_person_outbox_is_idempotent_and_redacted(audit):
    record = {
        "event_id": "event-1",
        "actor_user_id": "user-1",
        "username": "ops",
        "action": "token.create",
        "object_type": "token",
        "object_id": "token-1",
        "summary": {"password": "PASSWORD-SECRET", "token": "TOKEN-SECRET", "name": "ci"},
        "status": "ok",
    }
    assert await audit.log_person(record) is True
    assert await audit.log_person(record) is True
    rows, total = audit.query(kind="person", user_id="user-1")
    assert total == 1 and rows[0]["event_id"] == "event-1"
    assert "PASSWORD-SECRET" not in rows[0]["summary"] and "TOKEN-SECRET" not in rows[0]["summary"]
    assert "ci" in rows[0]["summary"]
    assert audit.query(kind="mcp")[1] == 0


async def test_retention_cleans_both_kinds_without_new_traffic(audit):
    await audit.log({"id": "old", "ts": past(31), "status": "ok"})
    await audit.log({"id": "recent", "ts": past(1), "status": "ok"})
    await audit.log_person({"event_id": "old-person", "ts": past(31), "status": "ok"})
    await audit.log_person({"event_id": "recent-person", "ts": past(1), "status": "ok"})
    # Reads enforce the retention window even before physical housekeeping runs.
    assert audit.query()[1] == audit.query(kind="person")[1] == 1
    audit.prune()
    with sqlite3.connect(audit.path) as conn:
        assert conn.execute("SELECT id FROM mcp_calls").fetchall() == [("recent",)]
        assert conn.execute("SELECT event_id FROM person_events").fetchall() == [("recent-person",)]


async def test_filters_pagination_and_export(audit):
    for i in range(7):
        await audit.log(
            {
                "id": f"call-{i}",
                "tool": "exec_command",
                "server": "web-1",
                "command": f"cmd{i}",
                "token_id": "token-1",
                "status": "ok",
            }
        )
    rows, total = audit.query(limit=3, offset=3, token_id="token-1", server="web-1")
    assert total == 7 and [row["command"] for row in rows] == ["cmd3", "cmd2", "cmd1"]
    assert audit.query(q="cmd6")[1] == 1
    assert audit.query(token_id="' OR 1=1 --")[1] == 0
    assert audit.query(q="' OR 1=1 --")[1] == 0
    assert len(audit.export_rows(token_id="token-1", cap=2)) == 2
    assert audit.query(since=past(-1))[1] == 0
    with pytest.raises(ValueError, match="kind"):
        audit.query(kind="mcp_calls;drop table person_events")


async def test_tool_error_result_and_remote_exit_code(audit):
    middleware = AuditMiddleware(audit)

    async def error_result(_):
        return ToolResult(content="password=hunter2", is_error=True)

    result = await middleware.on_call_tool(context(), error_result)
    assert result.is_error
    row = audit.query()[0][0]
    assert row["status"] == "error" and "hunter2" not in row["error"]

    async def failed_exit(_):
        return ToolResult(structured_content={"exit_code": 2})

    await middleware.on_call_tool(context(), failed_exit)
    assert audit.query()[0][0]["status"] == "error"
    assert audit.query()[0][0]["exit_code"] == 2


async def test_cancelled_call_and_timeout_are_distinct(audit):
    middleware = AuditMiddleware(audit)

    async def cancelled(_):
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await middleware.on_call_tool(context("cancel"), cancelled)
    assert audit.query()[0][0]["status"] == "cancelled"

    async def timeout(_):
        raise TimeoutError("remote timeout")

    with pytest.raises(TimeoutError):
        await middleware.on_call_tool(context("timeout"), timeout)
    assert audit.query()[0][0]["status"] == "timeout"


async def test_audit_io_failure_never_replaces_tool_outcome(audit, monkeypatch):
    def fail(*_args, **_kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(audit, "_write", fail)
    middleware = AuditMiddleware(audit)
    expected = ToolResult(content="operation complete")

    async def successful(_):
        return expected

    assert await middleware.on_call_tool(context(), successful) is expected
    assert await audit.log_person({"action": "token.create"}) is False

    async def failing(_):
        raise ValueError("original failure")

    with pytest.raises(ValueError, match="original failure"):
        await middleware.on_call_tool(context(), failing)


async def test_connection_failure_in_finish_is_safe(audit, monkeypatch):
    call_id = await audit.begin_call({"command": "uptime"})

    def fail():
        raise sqlite3.OperationalError("database offline")

    monkeypatch.setattr(audit, "_connection", fail)
    await audit.finish_call(call_id, {"status": "ok"})


async def test_cancellation_during_audit_write_falls_back_once(audit, monkeypatch):
    async def cancelled_thread(_operation):
        raise asyncio.CancelledError()

    monkeypatch.setattr(audit_module.asyncio, "to_thread", cancelled_thread)
    assert await audit.log_person({"event_id": "cancel-fallback", "action": "user.update"}) is True
    assert audit.query(kind="person")[1] == 1


async def test_close_then_reopen_preserves_data(audit):
    await audit.log({"command": "uptime"})
    audit.close()
    assert audit.query()[1] == 1


async def test_long_command_is_bounded_and_marked(audit):
    await audit.log({"command": "x" * 20_000, "status": "ok"})
    row = audit.query()[0][0]
    assert len(row["command"]) == 16_384 and row["truncated"] == 1
    assert redact({"password": "x", "name": "ok"}) == {"password": "[已脱敏]", "name": "ok"}


async def test_retry_attempts_share_stable_call_identity(audit):
    middleware = AuditMiddleware(audit)

    async def retried(_):
        await record_attempt(1, "started")
        await record_attempt(1, "error", "password=hidden")
        await record_attempt(2, "started")
        await record_attempt(2, "ok")
        return ToolResult(content="done")

    await middleware.on_call_tool(context(), retried)
    with sqlite3.connect(audit.path) as conn:
        attempts = conn.execute(
            "SELECT call_id,attempt,status,error FROM mcp_attempts ORDER BY attempt"
        ).fetchall()
    assert len(attempts) == 2 and attempts[0][0] == attempts[1][0]
    assert [item[2] for item in attempts] == ["error", "ok"]
    assert "hidden" not in attempts[0][3]
    await record_attempt(1, "started")  # outside a tool call is harmless


async def test_restart_marks_unfinished_calls_unknown(tmp_path):
    path = tmp_path / "audit.db"
    first = AuditLogger(path)
    await first.begin_call({"id": "interrupted", "command": "deploy"})
    first.close()
    second = AuditLogger(path)
    rows, _ = second.query()
    assert rows[0]["status"] == "unknown"
    assert rows[0]["ended_at"] is None
    assert "远端结果未知" in rows[0]["error"]
    second.close()


async def test_source_ip_does_not_trust_forwarded_header(audit, monkeypatch):
    monkeypatch.setattr(
        audit_module,
        "get_http_request",
        lambda: SimpleNamespace(
            client=SimpleNamespace(host="127.0.0.8"), headers={"x-forwarded-for": "attacker-value"}
        ),
    )

    async def invoke(_):
        return ToolResult(content="ok")

    await AuditMiddleware(audit).on_call_tool(context(), invoke)
    assert audit.query()[0][0]["source_ip"] == "127.0.0.8"


async def test_real_worker_cancellation_has_no_duplicate_person_event(audit, monkeypatch):
    import threading

    original = audit._write
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    def racing_write(*args):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            release.wait(timeout=2)
        else:
            release.set()
        original(*args)

    monkeypatch.setattr(audit, "_write", racing_write)
    task = asyncio.create_task(audit.log_person({"event_id": "race", "action": "token.update"}))
    assert await asyncio.to_thread(entered.wait, 2)
    task.cancel()
    assert await task is True
    release.set()
    # The cancelled worker can finish after fallback; both writes use event_id.
    await asyncio.to_thread(lambda: None)
    assert audit.query(kind="person")[1] == 1
