"""工作空间管理及真实 HTTP MCP 调用中的资源隔离与即时撤权。"""

import asyncio
import threading
from contextlib import asynccontextmanager
from itertools import count

import asyncssh
import pytest
from httpx2 import ASGITransport, AsyncClient

from ssh_mcp import authorization
from ssh_mcp.errors import AuthorizationError

_REQUEST_IDS = count(2)


@pytest.mark.parametrize("operation", ["revoke", "delete"])
async def test_cancelled_resource_write_publishes_revocation(gw, monkeypatch, operation):
    entered = threading.Event()
    release = threading.Event()
    method = "upsert_server" if operation == "revoke" else "delete_server"
    original = getattr(gw.cfg_file, method)

    def blocked_write(*args):
        entered.set()
        if not release.wait(timeout=5):
            raise TimeoutError("测试未释放配置写入")
        return original(*args)

    monkeypatch.setattr(gw.cfg_file, method, blocked_write)
    raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
    pending = asyncio.create_task(
        gw.state.upsert_server({**raw, "workspace_ids": []})
        if operation == "revoke" else gw.state.delete_server("web-1")
    )
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        pending.cancel()
        await asyncio.sleep(0)
        assert gw.state._lock.locked()
        assert not pending.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    live = gw.state.config.get_server("web-1")
    persisted = gw.cfg_file.load().get_server("web-1")
    assert live is None if operation == "delete" else live.workspace_ids == []
    assert persisted is None if operation == "delete" else persisted.workspace_ids == []
    with pytest.raises(AuthorizationError):
        await gw.state.pool.get_connection("web-1")


async def test_cancelled_workspace_delete_holds_config_lock(gw, monkeypatch):
    workspace = gw.state.identity.create_workspace("待删除空间")
    entered = threading.Event()
    release = threading.Event()
    original = gw.state.identity.delete_workspace

    def blocked_delete(*args):
        entered.set()
        if not release.wait(timeout=5):
            raise TimeoutError("测试未释放空间删除")
        return original(*args)

    monkeypatch.setattr(gw.state.identity, "delete_workspace", blocked_delete)
    pending = asyncio.create_task(gw.state.delete_workspace(workspace["id"], {}))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        pending.cancel()
        await asyncio.sleep(0)
        assert gw.state._lock.locked()
        assert not pending.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert gw.state.identity.workspace_info(workspace["id"]) is None


@asynccontextmanager
async def http_session(app, token):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://localhost",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"},
    ) as client:
        initialized = await client.post("/mcp", json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": {"name": "workspace-regression", "version": "1"},
            },
        })
        assert initialized.status_code == 200, initialized.text
        client.headers["Mcp-Session-Id"] = initialized.headers["mcp-session-id"]
        client.headers["MCP-Protocol-Version"] = "2025-06-18"
        ready = await client.post("/mcp", json={
            "jsonrpc": "2.0", "method": "notifications/initialized",
        })
        assert ready.status_code == 202
        yield client


async def invoke(client, name, **arguments):
    response = await client.post("/mcp", json={
        "jsonrpc": "2.0", "id": next(_REQUEST_IDS), "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    })
    assert response.status_code == 200, response.text
    return response.json()["result"]


@pytest.fixture
async def scoped(gw):
    second = gw.state.identity.create_workspace("项目乙")
    hidden = gw.state.identity.create_workspace("隔离项目")
    first = gw.workspace
    raw = {item["alias"]: item for item in gw.cfg_file.raw["servers"]}
    await gw.state.upsert_server({**raw["web-1"], "workspace_ids": [first["id"], second["id"]]})
    await gw.state.upsert_server({**raw["db-1"], "workspace_ids": [second["id"]]})
    await gw.state.upsert_server({**raw["db-1"], "alias": "a-only", "host": "10.1.0.1",
                                  "workspace_ids": [first["id"]]})
    await gw.state.upsert_server({**raw["db-1"], "alias": "hidden-c", "host": "10.2.0.1",
                                  "workspace_ids": [hidden["id"]]})
    other, _ = gw.state.identity.create_token("项目乙客户端", "fixture", workspace_id=second["id"])
    return gw, second, other


async def test_http_lists_health_and_every_remote_tool_are_scoped(scoped, harness):
    gw, _second, other = scoped
    app = gw.mcp.http_app(json_response=True, stateless_http=False)
    async with (app.router.lifespan_context(app),
                http_session(app, gw.tokens["alice"]) as a, http_session(app, other) as b):
        listed_a = await invoke(a, "list_servers")
        listed_b = await invoke(b, "list_servers")
        assert {row["alias"] for row in listed_a["structuredContent"]["servers"]} == {
            "web-1", "a-only"}
        assert {row["alias"] for row in listed_b["structuredContent"]["servers"]} == {
            "web-1", "db-1"}
        health = await invoke(a, "server_health")
        assert {row["alias"] for row in health["structuredContent"]["servers"]} == {
            "web-1", "a-only"}
        before = len(harness.connect_calls), len(harness.exec_calls)
        for name, arguments in [
            ("exec_command", {"command": "touch /forbidden"}),
            ("list_dir", {"path": "/"}),
            ("read_file", {"path": "/secret"}),
            ("upload_file", {"path": "/secret", "content": "private-body"}),
            ("download_file", {"path": "/secret"}),
            ("server_health", {}),
        ]:
            denied = await invoke(a, name, server="hidden-c", **arguments)
            assert denied["isError"], denied
            assert "10.2.0.1" not in str(denied) and "db-1" not in str(denied)
            assert "a-only" in str(denied)
        assert before == (len(harness.connect_calls), len(harness.exec_calls))
        denied_rows, total = gw.state.audit.query(status="denied")
        assert total == 6
        assert {row["workspace_id"] for row in denied_rows} == {gw.workspace["id"]}
        assert all(row["target_host"] is None for row in denied_rows)
        assert "private-body" not in str(denied_rows)


async def test_shared_connection_and_existing_http_session_obey_revocation(scoped, harness):
    gw, second, other = scoped
    app = gw.mcp.http_app(json_response=True, stateless_http=False)
    async with (app.router.lifespan_context(app),
                http_session(app, gw.tokens["alice"]) as a, http_session(app, other) as b):
        for client in (a, b):
            assert not (await invoke(client, "exec_command", server="web-1", command="whoami")).get("isError")
        assert len(harness.connect_calls) == 1  # One resource, one shared connection.
        raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
        await gw.state.upsert_server({**raw, "workspace_ids": [second["id"]]})
        before = len(harness.exec_calls)
        denied = await invoke(a, "exec_command", server="web-1", command="touch forbidden")
        assert denied["isError"] and "db-1" not in str(denied)
        assert len(harness.exec_calls) == before
        assert not (await invoke(b, "exec_command", server="web-1", command="still-allowed")).get("isError")
        assert len(harness.connect_calls) == 1
        listed = await invoke(a, "list_servers")
        assert [row["alias"] for row in listed["structuredContent"]["servers"]] == ["a-only"]
        gw.state.identity.update_workspace(gw.workspace["id"], "项目甲新名")
        await invoke(a, "list_servers")
        rows, _ = gw.state.audit.query(token_id=gw.state.identity.verify_token(gw.tokens["alice"])["id"])
        assert rows[0]["workspace_name"] == "项目甲新名"
        assert any(row["workspace_name"] == "测试空间" for row in rows)


async def test_http_concurrent_requests_do_not_exchange_workspaces(scoped, harness):
    gw, _second, other = scoped
    app = gw.mcp.http_app(json_response=True, stateless_http=False)
    async with (app.router.lifespan_context(app),
                http_session(app, gw.tokens["alice"]) as a, http_session(app, other) as b):
        results = await asyncio.gather(
            invoke(a, "exec_command", server="db-1", command="a-must-not-run"),
            invoke(b, "exec_command", server="db-1", command="b-permitted"),
            invoke(a, "exec_command", server="a-only", command="a-permitted"),
            invoke(b, "exec_command", server="a-only", command="b-must-not-run"),
        )
        assert [bool(row.get("isError")) for row in results] == [True, False, False, True]
        assert set(harness.exec_calls) == {"a-permitted", "b-permitted"}


async def test_retry_rechecks_current_resource_membership(gw, harness):
    attempts = 0

    async def revoke_and_disconnect(command, host):
        nonlocal attempts
        attempts += 1
        raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
        await gw.state.upsert_server({**raw, "workspace_ids": []})
        raise asyncssh.ConnectionLost("disconnect after access changed")

    harness.exec_behavior = revoke_and_disconnect
    from fastmcp import Client
    async with Client(gw.mcp) as client:
        result = await client.call_tool("exec_command", {"server": "web-1", "command": "run-once"},
                                        raise_on_error=False)
        assert result.is_error
    assert attempts == 1 and len(harness.connect_calls) == 1
    assert gw.state.audit.query(status="denied")[1] == 1


async def test_untrusted_in_memory_call_has_no_implicit_access(gw, monkeypatch, harness):
    monkeypatch.setattr(authorization, "get_access_token", lambda: None)
    with pytest.raises(AuthorizationError):
        await gw.state.pool.get_connection("web-1")
    from fastmcp import Client
    async with Client(gw.mcp) as client:
        result = await client.call_tool("list_servers", {}, raise_on_error=False)
        assert result.is_error
    assert harness.connect_calls == []


async def test_workspace_api_uses_shared_login_csrf_and_references(gw):
    app = gw.mcp.http_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as web:
        assert (await web.get("/api/workspaces")).status_code == 401
        setup = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        web.headers["X-CSRF-Token"] = setup.json()["csrf_token"]
        denied = await web.post("/api/workspaces", json={"name": "甲"}, headers={"X-CSRF-Token": "wrong"})
        assert denied.status_code == 403
        created = await web.post("/api/workspaces", json={"name": "甲"})
        assert created.status_code == 201
        workspace = created.json()["workspace"]
        assert (await web.post("/api/workspaces", json={"name": "甲"})).status_code == 409
        assert (await web.patch(f"/api/workspaces/{workspace['id']}", json={"name": "乙"})).json()["workspace"]["name"] == "乙"
        assert (await web.post("/api/tokens", json={"name": "missing"})).status_code == 400
        token = await web.post("/api/tokens", json={"name": "bound", "workspace_id": workspace["id"]})
        assert token.status_code == 201 and token.json()["item"]["workspace_id"] == workspace["id"]
        token_id = token.json()["item"]["id"]
        assert (await web.patch(f"/api/tokens/{token_id}", json={"workspace_id": gw.workspace["id"]})).status_code == 400
        assert (await web.delete(f"/api/workspaces/{workspace['id']}")).status_code == 409
        await web.patch(f"/api/tokens/{token_id}", json={"enabled": False})
        assert (await web.delete(f"/api/workspaces/{workspace['id']}")).status_code == 409
        await web.delete(f"/api/tokens/{token_id}")
        raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
        saved = await web.put("/api/servers/web-1", json={**raw, "workspace_ids": [workspace["id"]]})
        assert saved.status_code == 200
        assert (await web.delete(f"/api/workspaces/{workspace['id']}")).status_code == 409
        await web.put("/api/servers/web-1", json={**raw, "workspace_ids": []})
        assert (await web.delete(f"/api/workspaces/{workspace['id']}")).status_code == 200
        records, _ = gw.state.audit.query(kind="person", q="server.update")
        assert any(workspace["id"] in row["summary"] and "乙" in row["summary"] for row in records)
        assert {row["alias"] for row in (await web.get("/api/servers")).json()["servers"]} == {"web-1", "db-1"}


async def test_target_change_during_audit_does_not_use_old_connection(gw, harness, monkeypatch):
    original = gw.state.audit.begin_call

    async def reconfigure(record):
        call_id = await original(record)
        raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
        await gw.state.upsert_server({**raw, "host": "changed-during-call"})
        return call_id

    monkeypatch.setattr(gw.state.audit, "begin_call", reconfigure)
    from fastmcp import Client
    async with Client(gw.mcp) as client:
        result = await client.call_tool("exec_command", {"server": "web-1", "command": "must-not-run"},
                                        raise_on_error=False)
        assert result.is_error
    assert harness.exec_calls == [] and harness.connect_calls == []
    assert gw.state.audit.query(status="denied")[1] == 1
