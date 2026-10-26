"""网页会话与 MCP 凭证隔离、同权管理、资源与双审计集成。"""

import asyncssh
import pytest
from fastmcp import Client
from httpx2 import ASGITransport, AsyncClient

_NEW_SERVER = {
    "alias": "cache-1",
    "host": "10.0.0.30",
    "username": "redis",
    "credential": {"type": "password", "password": "redis-pw"},
}


@pytest.fixture
async def web(gw):
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://t"
    ) as client:
        yield client


@pytest.fixture
async def logged(web, gw):
    response = await web.post(
        "/api/auth/setup",
        json={
            "username": "alice",
            "password": "alice-password",
            "setup_key": gw.state.identity.setup_key_path.read_text(),
        },
    )
    assert response.status_code == 201, response.text
    web.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return web


async def test_static_health_and_no_default_admin(web):
    assert (await web.get("/")).status_code == 200
    assert (await web.get("/healthz")).json() == {"ok": True}
    assert (await web.get("/api/auth/status")).json() == {"setup_required": True}
    assert (await web.get("/api/me")).status_code == 401
    assert (
        await web.get("/api/me", headers={"Authorization": "Bearer tok-alice"})
    ).status_code == 401
    assert (
        await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    ).status_code == 401


async def test_setup_cookie_csrf_and_logout(logged):
    me = (await logged.get("/api/me")).json()
    assert me["user"]["username"] == "alice" and "admin" not in me["user"]
    assert (await logged.post("/api/auth/setup", json={})).status_code == 400
    assert (
        await logged.post("/api/servers", json=_NEW_SERVER, headers={"X-CSRF-Token": "wrong"})
    ).status_code == 403
    assert (await logged.post("/api/auth/logout")).status_code == 200
    assert (await logged.get("/api/me")).status_code == 401


async def test_username_password_login_and_cookie_flags(web, logged):
    await logged.post("/api/auth/logout")
    bad = await web.post("/api/auth/login", json={"username": "alice", "password": "wrong"})
    assert bad.status_code == 401
    good = await web.post(
        "/api/auth/login", json={"username": "alice", "password": "alice-password"}
    )
    assert good.status_code == 200
    cookie = good.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert "password" not in good.text


async def test_all_users_same_capabilities_and_session_revocation(logged):
    alice_id = (await logged.get("/api/me")).json()["user"]["id"]
    created = await logged.post("/api/users", json={"username": "bob", "password": "bob-password"})
    assert created.status_code == 201
    bob_id = created.json()["id"]
    await logged.post("/api/auth/logout")
    response = await logged.post(
        "/api/auth/login", json={"username": "bob", "password": "bob-password"}
    )
    logged.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    assert (await logged.post("/api/servers", json=_NEW_SERVER)).status_code == 201
    assert (await logged.get("/api/users")).status_code == 200
    assert (
        await logged.patch(f"/api/users/{alice_id}", json={"enabled": False})
    ).status_code == 200
    assert (await logged.patch(f"/api/users/{bob_id}", json={"enabled": False})).status_code == 400
    assert (
        await logged.patch(f"/api/users/{bob_id}", json={"password": "changed-password"})
    ).status_code == 200
    assert (await logged.get("/api/me")).status_code == 401


async def test_resource_crud_preserves_secret_and_hot_reload(logged, gw):
    response = await logged.post("/api/servers", json=_NEW_SERVER)
    assert response.status_code == 201 and "redis-pw" not in response.text
    response = await logged.put(
        "/api/servers/cache-1", json={"host": "10.0.0.31", "username": "redis"}
    )
    assert response.status_code == 200 and response.json()["host"] == "10.0.0.31"
    assert (
        gw.state.config.get_server("cache-1").credential.password.get_secret_value() == "redis-pw"
    )
    async with Client(gw.mcp) as client:
        result = await client.call_tool("list_servers", {})
        assert len(result.data.servers) == 3
    assert (await logged.delete("/api/servers/cache-1")).status_code == 200
    assert (await logged.delete("/api/servers/cache-1")).status_code == 404
    assert (await logged.put("/api/servers/missing", json={})).status_code == 404
    response = await logged.post("/api/servers", json={**_NEW_SERVER, "alias": "bad alias"})
    assert response.status_code == 400 and "redis-pw" not in response.text
    response = await logged.get("/api/servers")
    assert "db-pw" not in response.text and "/keys/web-1.pem" not in response.text


async def test_connection_and_key_operations(logged, gw, harness, tmp_path):
    response = await logged.post("/api/servers/test", json=_NEW_SERVER)
    assert response.json()["ok"] and gw.state.pool._conns == {}
    harness.fail_next_connect = OSError("refused")
    response = await logged.post("/api/servers/test", json=_NEW_SERVER)
    assert response.json()["ok"] is False
    key = asyncssh.generate_private_key("ssh-ed25519").export_private_key().decode()
    response = await logged.post("/api/keys", json={"alias": "web-1", "content": key})
    assert response.status_code == 200
    assert (tmp_path / "keys/web-1.pem").read_text() == key
    assert (tmp_path / "keys/web-1.pem").stat().st_mode & 0o777 == 0o600
    for alias in ("../evil", "a/b", "has space", ""):
        assert (
            await logged.post("/api/keys", json={"alias": alias, "content": key})
        ).status_code == 400
    assert (
        await logged.post("/api/keys", json={"alias": "web-1", "content": "not-key"})
    ).status_code == 400


async def test_token_management_and_old_token_independence(logged, gw):
    old = await gw.mcp.auth.verify_token("tok-bob")
    assert old is not None
    created = await logged.post("/api/tokens", json={"name": "new-codex", "description": "CI"})
    assert created.status_code == 201
    value, item = created.json()["token"], created.json()["item"]
    assert (await gw.mcp.auth.verify_token(value)).client_id == item["id"]
    assert await gw.mcp.auth.verify_token("tok-bob") is not None
    response = await logged.get("/api/tokens")
    assert value not in response.text and "tok-bob" not in response.text
    assert (
        await logged.patch(f"/api/tokens/{item['id']}", json={"enabled": False})
    ).status_code == 200
    assert await gw.mcp.auth.verify_token(value) is None
    assert (
        await logged.patch(f"/api/tokens/{item['id']}", json={"enabled": True})
    ).status_code == 200
    assert (await logged.delete(f"/api/tokens/{item['id']}")).status_code == 200
    assert await gw.mcp.auth.verify_token(value) is None
    assert (
        await logged.patch(f"/api/tokens/{item['id']}", json={"enabled": True})
    ).status_code == 400
    user_session = logged.cookies.get("ssh_mcp_session")
    assert await gw.mcp.auth.verify_token(user_session) is None


async def test_person_audit_attribution_and_no_secrets(logged):
    created = await logged.post("/api/tokens", json={"name": "=formula"})
    token, token_id = created.json()["token"], created.json()["item"]["id"]
    await logged.patch(f"/api/tokens/{token_id}", json={"name": "renamed"})
    await logged.post("/api/users", json={"username": "bob", "password": "second-password"})
    response = await logged.get("/api/audit", params={"kind": "person"})
    assert response.status_code == 200
    records = response.json()["records"]
    updates = [r for r in records if r["action"] == "token.update"]
    assert updates[0]["username"] == "alice" and updates[0]["object_id"] == token_id
    assert token not in response.text and "second-password" not in response.text
    assert (await logged.get("/api/audit/export", params={"kind": "person"})).status_code == 200
    assert (await logged.get("/api/audit", params={"kind": "invalid"})).status_code == 400


async def test_bad_json_and_secret_errors_are_readable(logged):
    response = await logged.post(
        "/api/users", content="[1]", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    response = await logged.post(
        "/api/servers/test",
        json={
            "alias": "x",
            "host": "h",
            "username": "u",
            "credential": {"type": "bad", "password": "sensitive-value"},
        },
    )
    assert response.status_code == 400 and "sensitive-value" not in response.text


async def test_established_http_mcp_session_rejects_revoked_token(gw):
    """真实 HTTP 中间件：已初始化的会话不能凭旧 token 绕过吊销。"""
    app = gw.mcp.http_app(json_response=True, stateless_http=False)
    headers = {
        "Authorization": "Bearer tok-alice",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app), base_url="http://localhost", headers=headers
        ) as client,
    ):
        initialized = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "regression-client", "version": "1"},
                },
            },
        )
        assert initialized.status_code == 200, initialized.text
        session = initialized.headers.get("mcp-session-id")
        assert session
        client.headers["Mcp-Session-Id"] = session
        client.headers["MCP-Protocol-Version"] = "2025-06-18"
        ready = await client.post(
            "/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}
        )
        assert ready.status_code == 202
        listed = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        assert listed.status_code == 200, listed.text
        item = gw.state.identity.verify_token("tok-alice")
        gw.state.identity.revoke_token(item["id"])
        denied = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        assert denied.status_code == 401, denied.text


async def test_setup_normalizes_username_before_creating_session(web, gw):
    response = await web.post(
        "/api/auth/setup",
        json={
            "username": " review ",
            "password": "correct-password",
            "setup_key": gw.state.identity.setup_key_path.read_text(),
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["username"] == "review"
    assert (await web.get("/api/me")).status_code == 200
    assert not gw.state.identity.setup_key_path.exists()


async def test_resource_side_effect_has_running_then_cancelled_audit(logged, gw, monkeypatch):
    import asyncio
    import threading

    entered = threading.Event()
    release = threading.Event()
    original_save = gw.cfg_file.save

    def blocked_save():
        entered.set()
        release.wait(timeout=10)
        original_save()

    monkeypatch.setattr(gw.cfg_file, "save", blocked_save)
    pending = asyncio.create_task(logged.post("/api/servers", json=_NEW_SERVER))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        rows, _ = gw.state.audit.query(kind="person", q="server.create")
        started = next(row for row in rows if row["action"] == "server.create")
        assert started["status"] == "running"
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        rows, _ = gw.state.audit.query(kind="person", q="server.create")
        terminal = next(row for row in rows if row["event_id"] == started["event_id"])
        assert terminal["status"] == "cancelled"
        assert terminal["ts"] == started["ts"]
        assert "结果未知" in terminal["error"]
    finally:
        release.set()
        if not pending.done():
            await pending
