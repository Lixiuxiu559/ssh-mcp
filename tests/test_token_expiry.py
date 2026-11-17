"""显式到期的迁移、精确截止、HTTP 会话及等待/重试授权回归。"""

import asyncio
import json
import math
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncssh
import pytest
from fastmcp import Client
from httpx2 import ASGITransport, AsyncClient

from ssh_mcp.auth import IdentityError, IdentityStore
from ssh_mcp.auth.expiry import expiry_epoch
from ssh_mcp.auth.verifier import StoreTokenVerifier
from ssh_mcp.authorization import authorize_server
from ssh_mcp.config import ConfigFile
from ssh_mcp.errors import AuthorizationError
from ssh_mcp.server import create_mcp


def deadline(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds")


@pytest.fixture
def identity(tmp_path):
    store = IdentityStore(tmp_path / "service.db")
    store.ensure_default_account()
    user = store.list_users()[0]
    workspace = store.create_workspace("到期项目")
    yield store, user, workspace
    store.close()


def issue(identity, **kwargs):
    store, user, workspace = identity
    return store.create_token("client", user["id"], workspace_id=workspace["id"], **kwargs)


def test_nullable_schema_migration_preserves_existing_credentials_and_key(identity):
    store, _user, _workspace = identity
    value, item = issue(identity)
    _, session, csrf = store.login("admin", "admin")
    key = store.token_key_path.read_bytes()
    before = dict(store._connection().execute("SELECT * FROM tokens").fetchone())
    before.pop("expires_at")
    store.close()
    with sqlite3.connect(store.path) as conn:
        conn.execute("ALTER TABLE tokens DROP COLUMN expires_at")
    reopened = IdentityStore(store.path)
    try:
        migrated = dict(reopened._connection().execute("SELECT * FROM tokens").fetchone())
        assert migrated.pop("expires_at") is None
        assert migrated == before
        assert reopened.token_key_path.read_bytes() == key
        assert reopened.reveal_token(item["id"]) == value
        assert reopened.verify_token(value)["id"] == item["id"]
        assert reopened.session(session)[1] == csrf
        assert reopened.token_info(item["id"])["expired"] is False
    finally:
        reopened.close()


def test_concurrent_old_schema_upgrade_preserves_shared_credentials(identity, monkeypatch):
    store, _user, workspace = identity
    value, token = issue(identity)
    _, session, csrf = store.login("admin", "admin")
    key = store.token_key_path.read_bytes()
    before = dict(store._connection().execute("SELECT * FROM tokens").fetchone())
    before.pop("expires_at")
    store.close()
    with sqlite3.connect(store.path) as conn:
        conn.execute("ALTER TABLE tokens DROP COLUMN expires_at")

    startup = threading.Barrier(2)
    unlocked_reads = threading.Barrier(2)
    original_connect = sqlite3.connect

    class ConcurrentMigrationConnection(sqlite3.Connection):
        def executescript(self, script):
            result = super().executescript(script)
            assert not self.in_transaction
            startup.wait(timeout=5)
            return result

        def execute(self, statement, parameters=()):
            cursor = super().execute(statement, parameters)
            if statement == "PRAGMA table_info(tokens)" and not self.in_transaction:
                # Without a write transaction, force both starts to observe the
                # same old schema before either can try ADD COLUMN.
                rows = cursor.fetchall()
                unlocked_reads.wait(timeout=5)
                return rows
            return cursor

    def concurrent_connect(*args, **kwargs):
        return original_connect(*args, factory=ConcurrentMigrationConnection, **kwargs)

    connections = []

    def reopen():
        connection = IdentityStore(store.path)
        connections.append(connection)
        snapshot = dict(connection._connection().execute("SELECT * FROM tokens").fetchone())
        return connection, snapshot

    monkeypatch.setattr(sqlite3, "connect", concurrent_connect)
    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = [workers.submit(reopen) for _ in range(2)]
            results = [future.result(timeout=10) for future in futures]
        for connection, snapshot in results:
            assert snapshot.pop("expires_at") is None and snapshot == before
            assert connection.token_key_path.read_bytes() == key
            assert connection.reveal_token(token["id"]) == value
            assert connection.verify_token(value)["id"] == token["id"]
            assert connection.active_token_info(token["id"])["workspace_id"] == workspace["id"]
            assert connection.session(session)[1] == csrf
            assert connection.token_info(token["id"])["expired"] is False
    finally:
        for connection in connections:
            connection.close()


@pytest.mark.parametrize(
    "value",
    [
        "",
        1,
        False,
        [],
        {},
        "2026-11-18T00:00:00",
        "2026-11-18",
        "garbage",
        "2026-11-18T00:00:00+99:00",
        "2036-02-30T00:00:00Z",
        "2030-01-01T00:00:00+00:60",
    ],
)
def test_invalid_expiry_creates_neither_token_nor_success_outbox(identity, value):
    store, _user, _workspace = identity
    before = store.pending_events()
    with pytest.raises(IdentityError, match="到期时间"):
        issue(identity, expires_at=value, event={"action": "token.create", "status": "ok"})
    assert store.list_tokens() == []
    assert store.pending_events() == before
    assert not store.token_key_path.exists()


def test_precise_expiry_normalization_update_and_independent_enabled_state(identity, monkeypatch):
    store, _user, _workspace = identity
    clock = [expiry_epoch("2030-01-01T00:00:00.000Z")]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    end = "2030-01-01T00:00:01.123+00:00"
    value, item = issue(identity, expires_at="2030-01-01T08:00:01.123+08:00")
    assert item["expires_at"] == end and item["expired"] is False
    for past in (deadline(clock[0] - 1), deadline(clock[0])):
        before = store.pending_events()
        with pytest.raises(IdentityError, match="晚于"):
            issue(identity, expires_at=past, event={"action": "token.create"})
        assert store.pending_events() == before
    clock[0] = expiry_epoch(end) - 0.001
    assert store.verify_token(value) and store.active_token_info(item["id"])
    used = store.token_info(item["id"])["last_used_at"]
    clock[0] = expiry_epoch(end)
    assert store.verify_token(value) is None and store.active_token_info(item["id"]) is None
    assert store.token_info(item["id"])["last_used_at"] == used
    assert store.list_tokens()[0]["expired"] is True
    assert store.reveal_token(item["id"]) == value
    # Expiry does not disable a credential, and metadata edits preserve the old deadline.
    edited = store.update_token(item["id"], {"name": "renamed", "description": "expired"})
    assert edited["enabled"] is True and edited["expires_at"] == end
    assert store.update_token(item["id"], {"expires_at": end})["expired"] is True
    with pytest.raises(IdentityError, match="晚于"):
        store.update_token(item["id"], {"expires_at": deadline(clock[0] - 0.001)})
    later = deadline(clock[0] + 60)
    assert store.update_token(item["id"], {"expires_at": later})["expired"] is False
    assert store.verify_token(value)
    store.update_token(item["id"], {"enabled": False})
    assert store.update_token(item["id"], {"expires_at": None})["expires_at"] is None
    assert store.verify_token(value) is None
    store.update_token(item["id"], {"enabled": True})
    assert store.verify_token(value)
    store.delete_token(item["id"])
    with pytest.raises(IdentityError, match="已删除"):
        store.update_token(item["id"], {"expires_at": None, "enabled": True})


@pytest.mark.parametrize("invalid", ["", "broken", "2030-01-01T00:00:00", "[]", 1])
def test_invalid_persisted_deadline_fails_closed_without_advancing_usage(identity, invalid):
    store, _user, _workspace = identity
    value, item = issue(identity)
    assert store.verify_token(value)
    used = store.token_info(item["id"])["last_used_at"]
    with store._connection() as conn:
        conn.execute("UPDATE tokens SET expires_at=? WHERE id=?", (invalid, item["id"]))
    assert store.verify_token(value) is None
    assert store.active_token_info(item["id"]) is None
    assert store.token_info(item["id"])["expired"] is True
    assert store.token_info(item["id"])["last_used_at"] == used
    assert store.reveal_token(item["id"]) == value
    assert store.update_token(item["id"], {"expires_at": None})["expired"] is False


async def test_verifier_ceils_sdk_seconds_but_store_enforces_exact_deadline(identity, monkeypatch):
    store, _user, _workspace = identity
    now = expiry_epoch("2030-01-01T00:00:00Z")
    clock = [now]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    value, item = issue(identity, expires_at=deadline(now + 1.123))
    verifier = StoreTokenVerifier(store)
    access = await verifier.verify_token(value)
    assert access.client_id == item["id"] and access.expires_at == math.ceil(now + 1.123)
    clock[0] = now + 1.123
    assert await verifier.verify_token(value) is None
    unlimited, _ = issue(identity, expires_at=None)
    assert (await verifier.verify_token(unlimited)).expires_at is None


@asynccontextmanager
async def login_web(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as web:
        result = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        web.headers["X-CSRF-Token"] = result.json()["csrf_token"]
        yield web


async def test_expiry_http_validation_is_atomic_and_expired_metadata_is_editable(gw):
    async with login_web(gw.mcp.http_app()) as web:
        count = len(gw.state.identity.list_tokens())
        for invalid in ("", 1, False, [], {}, "2030-01-01T00:00:00", deadline(time.time() - 1)):
            rejected = await web.post(
                "/api/tokens",
                json={
                    "name": "bad-expiry",
                    "workspace_id": gw.workspace["id"],
                    "expires_at": invalid,
                },
            )
            assert rejected.status_code == 400, rejected.text
            assert len(gw.state.identity.list_tokens()) == count
            assert gw.state.identity.pending_events() == []
        rows, _ = gw.state.audit.query(kind="person", q="token.create")
        assert len(rows) == 7 and all(row["status"] == "error" for row in rows)
        end = deadline(time.time() + 3600)
        response = await web.post(
            "/api/tokens",
            json={
                "name": "valid",
                "workspace_id": gw.workspace["id"],
                "expires_at": end,
            },
        )
        assert response.status_code == 201 and response.json()["item"]["expires_at"] == end
        item, value = response.json()["item"], response.json()["token"]
        path = f"/api/tokens/{item['id']}"
        before = gw.state.identity.token_info(item["id"])
        for invalid in ("", [], "bad", deadline(time.time() - 1)):
            assert (
                await web.patch(path, json={"name": "must-not-change", "expires_at": invalid})
            ).status_code == 400
            assert gw.state.identity.token_info(item["id"]) == before
        with gw.state.identity._connection() as conn:
            conn.execute(
                "UPDATE tokens SET expires_at=? WHERE id=?", (deadline(time.time() - 1), item["id"])
            )
        renamed = await web.patch(path, json={"name": "expired-renamed"})
        assert renamed.status_code == 200 and renamed.json()["expired"] is True
        assert (await web.post(path + "/reveal")).json() == {"token": value}
        cleared = await web.patch(path, json={"expires_at": None})
        assert cleared.json()["expires_at"] is None and cleared.json()["expired"] is False
        assert gw.state.identity.verify_token(value)["id"] == item["id"]
        listed = await web.get("/api/tokens")
        assert value not in listed.text and all(
            "expired" in t and "expires_at" in t for t in listed.json()["tokens"]
        )


async def initialize_http(client):
    response = await client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "expiry-regression", "version": "1"},
            },
        },
    )
    assert response.status_code == 200, response.text
    client.headers["Mcp-Session-Id"] = response.headers["mcp-session-id"]
    client.headers["MCP-Protocol-Version"] = "2025-06-18"
    assert (
        await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            },
        )
    ).status_code == 202


async def test_existing_http_session_and_full_service_restart_do_not_extend_expiry(
    gw, harness, monkeypatch
):
    clock = [time.time()]
    end = math.ceil(clock[0]) + 60.123
    token = gw.state.identity.token_for_audit(gw.tokens["alice"])
    gw.state.identity.update_token(token["id"], {"expires_at": deadline(end)})
    monkeypatch.setattr(time, "time", lambda: clock[0])
    app = gw.mcp.http_app(json_response=True, stateless_http=False)
    headers = {
        "Authorization": f"Bearer {gw.tokens['alice']}",
        "Accept": "application/json, text/event-stream",
    }
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app), base_url="http://localhost", headers=headers
        ) as client,
    ):
        await initialize_http(client)
        call = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "exec_command",
                "arguments": {"server": "web-1", "command": "before-expiry"},
            },
        }
        clock[0] = end - 0.001
        response = await client.post("/mcp", json=call)
        assert response.status_code == 200 and not response.json()["result"].get("isError")
        used = gw.state.identity.token_info(token["id"])["last_used_at"]
        before = list(harness.exec_calls)
        clock[0] = end
        assert (await client.post("/mcp", json=call)).status_code == 401
        assert (
            await client.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        ).status_code == 401
        assert harness.exec_calls == before
        assert gw.state.identity.token_info(token["id"])["last_used_at"] == used
        denied, _ = gw.state.audit.query(status="denied")
        assert len(denied) == 2 and all(
            row["token_id"] == token["id"] and "到期" in row["error"] for row in denied
        )
        assert gw.tokens["alice"] not in json.dumps(denied)
    restarted, state = create_mcp(ConfigFile(gw.config_path))
    try:
        assert state.identity.token_info(token["id"])["expires_at"] == deadline(end)
        assert await restarted.auth.verify_token(gw.tokens["alice"]) is None
        assert await restarted.auth.verify_token(gw.tokens["bob"])  # no default deadline
        assert state.identity.token_info(token["id"])["last_used_at"] == used
    finally:
        await state.shutdown()


async def test_expiry_during_worker_lookup_is_rechecked_before_returning_resource(gw, monkeypatch):
    clock = [time.time()]
    end = clock[0] + 10
    item = gw.state.identity.token_for_audit(gw.tokens["alice"])
    gw.state.identity.update_token(item["id"], {"expires_at": deadline(end)})
    # Use the canonical stored millisecond deadline for the equality check.
    end = expiry_epoch(gw.state.identity.token_info(item["id"])["expires_at"])
    monkeypatch.setattr(time, "time", lambda: clock[0])
    entered, release = threading.Event(), threading.Event()
    original = gw.state.identity.active_token_info

    def paused(token_id):
        info = original(token_id)
        entered.set()
        assert release.wait(timeout=5)
        return info

    monkeypatch.setattr(gw.state.identity, "active_token_info", paused)
    pending = asyncio.create_task(authorize_server(gw.state, "web-1"))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        clock[0] = end
        release.set()
        with pytest.raises(AuthorizationError, match="到期"):
            await pending
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)


async def test_connection_retry_after_expiry_does_not_start_another_external_attempt(
    gw, harness, monkeypatch
):
    clock = [time.time()]
    item = gw.state.identity.token_for_audit(gw.tokens["alice"])
    end = math.ceil(clock[0]) + 10.123
    gw.state.identity.update_token(item["id"], {"expires_at": deadline(end)})
    monkeypatch.setattr(time, "time", lambda: clock[0])

    async def expire_and_disconnect(command, host):
        clock[0] = end
        raise asyncssh.ConnectionLost("disconnect at expiry")

    harness.exec_behavior = expire_and_disconnect
    async with Client(gw.mcp) as client:
        result = await client.call_tool(
            "exec_command", {"server": "web-1", "command": "one-attempt"}, raise_on_error=False
        )
        assert result.is_error
    assert harness.exec_calls == ["one-attempt"] and len(harness.connect_calls) == 1
    assert gw.state.audit.query(status="denied")[1] == 1


async def test_expiry_while_waiting_for_connection_slot_prevents_remote_access(
    gw, harness, monkeypatch
):
    clock = [time.time()]
    item = gw.state.identity.token_for_audit(gw.tokens["alice"])
    end = math.ceil(clock[0]) + 10.123
    gw.state.identity.update_token(item["id"], {"expires_at": deadline(end)})
    monkeypatch.setattr(time, "time", lambda: clock[0])
    entered = asyncio.Event()
    slot = asyncio.Semaphore(0)
    original = gw.state.pool._entry

    async def observed_entry(alias):
        result = await original(alias)
        entered.set()
        return result

    monkeypatch.setattr(gw.state.pool, "_entry", observed_entry)
    monkeypatch.setattr(gw.state.pool, "_semaphore", lambda alias: slot)
    async with Client(gw.mcp) as client:
        pending = asyncio.create_task(
            client.call_tool(
                "exec_command",
                {"server": "web-1", "command": "blocked-until-expired"},
                raise_on_error=False,
            )
        )
        try:
            await asyncio.wait_for(entered.wait(), timeout=2)
            clock[0] = end
            slot.release()
            assert (await pending).is_error
        finally:
            slot.release()
            await asyncio.gather(pending, return_exceptions=True)
    assert harness.connect_calls == [] and harness.exec_calls == []
    assert gw.state.audit.query(status="denied")[1] == 1


async def test_expiry_during_connect_prevents_command_and_does_not_cache_connection(
    gw, harness, monkeypatch
):
    clock = [time.time()]
    item = gw.state.identity.token_for_audit(gw.tokens["alice"])
    end = math.ceil(clock[0]) + 10.123
    gw.state.identity.update_token(item["id"], {"expires_at": deadline(end)})
    monkeypatch.setattr(time, "time", lambda: clock[0])
    original = harness.connect

    async def connect_at_expiry(**kwargs):
        connection = await original(**kwargs)
        clock[0] = end
        return connection

    monkeypatch.setattr(asyncssh, "connect", connect_at_expiry)
    async with Client(gw.mcp) as client:
        result = await client.call_tool(
            "exec_command", {"server": "web-1", "command": "must-not-start"}, raise_on_error=False
        )
        assert result.is_error
    assert len(harness.connect_calls) == 1 and harness.exec_calls == []
    assert gw.state.pool._conns == {}


async def test_operation_already_sent_before_expiry_keeps_its_actual_result(
    gw, harness, monkeypatch
):
    clock = [time.time()]
    item = gw.state.identity.token_for_audit(gw.tokens["alice"])
    end = math.ceil(clock[0]) + 10.123
    gw.state.identity.update_token(item["id"], {"expires_at": deadline(end)})
    monkeypatch.setattr(time, "time", lambda: clock[0])
    original = harness.exec_behavior

    def operation(command, host):
        clock[0] = end
        return original(command, host)

    harness.exec_behavior = operation
    async with Client(gw.mcp) as client:
        completed = await client.call_tool(
            "exec_command", {"server": "web-1", "command": "already-sent"}, raise_on_error=False
        )
        assert not completed.is_error
        rejected = await client.call_tool(
            "exec_command", {"server": "web-1", "command": "after-expiry"}, raise_on_error=False
        )
        assert rejected.is_error
    assert harness.exec_calls == ["already-sent"]
    rows, total = gw.state.audit.query(status="ok")
    assert total == 1 and rows[0]["token_id"] == item["id"]
