"""首次启动默认账号、持久化和并发初始化回归。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from httpx2 import ASGITransport, AsyncClient

from ssh_mcp.auth import IdentityError, IdentityStore
from ssh_mcp.config import ConfigFile
from ssh_mcp.server import create_mcp


async def test_default_login_and_password_change_survive_restart(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("servers: []\n")
    mcp, state = create_mcp(ConfigFile(path))
    try:
        async with AsyncClient(transport=ASGITransport(app=mcp.http_app()), base_url="http://t") as web:
            assert (await web.get("/api/auth/status")).json() == {"setup_required": False}
            assert not state.identity.setup_key_path.exists()
            login = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
            assert login.status_code == 200
            user_id = login.json()["user"]["id"]
            headers = {"X-CSRF-Token": login.json()["csrf_token"]}
            short = await web.patch(f"/api/users/{user_id}", headers=headers, json={"password": "admin"})
            assert short.status_code == 400
            changed = await web.patch(f"/api/users/{user_id}", headers=headers, json={"password": "new123"})
            assert changed.status_code == 200
            assert (await web.get("/api/me")).status_code == 401
        workspace = state.identity.create_workspace("项目 A")
        token, item = state.identity.create_token("client", user_id, workspace_id=workspace["id"])
        assert state.identity.verify_token("admin") is None
        row = state.identity._connection().execute("SELECT password_hash FROM users").fetchone()
        assert row[0].startswith("scrypt$") and "new123" not in row[0]
    finally:
        await state.shutdown()

    mcp, restarted = create_mcp(ConfigFile(path))
    try:
        async with AsyncClient(transport=ASGITransport(app=mcp.http_app()), base_url="http://t") as web:
            old = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
            assert old.status_code == 401
            login = await web.post("/api/auth/login", json={"username": "admin", "password": "new123"})
            assert login.status_code == 200
            assert login.json()["user"]["id"] == user_id
        assert len(restarted.identity.list_users()) == 1
        assert restarted.identity.verify_token(token)["id"] == item["id"]
        history = restarted.audit.query(kind="person", limit=100)
        assert sum(row["action"] == "user.initialize" and row["status"] == "ok" for row in history[0]) == 1
    finally:
        await restarted.shutdown()


@pytest.mark.parametrize("enabled", [True, False])
def test_existing_users_without_admin_do_not_create_default_account(tmp_path, enabled):
    path = tmp_path / "service.db"
    store = IdentityStore(path)
    user = store.initialize("ops", "existing-password", store.setup_key_path.read_text())
    if not enabled:
        # 模拟存量库中全部账号被禁用，不通过默认账号恢复入口绕过状态。
        with store._connection() as conn:
            conn.execute("UPDATE users SET enabled=0")
    store.close()
    reopened = IdentityStore(path)
    try:
        reopened.ensure_default_account()
        assert reopened.list_users()[0]["id"] == user["id"]
        assert [row["username"] for row in reopened.list_users()] == ["ops"]
        assert reopened.list_users()[0]["enabled"] is enabled
        with pytest.raises(IdentityError, match="用户名或密码"):
            reopened.login("admin", "admin")
    finally:
        reopened.close()


def test_concurrent_initialization_creates_one_hashed_account_and_event(tmp_path):
    first = IdentityStore(tmp_path / "service.db")
    second = IdentityStore(first.path)
    barrier = Barrier(2)

    def initialize(store):
        barrier.wait(timeout=5)
        store.ensure_default_account()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(initialize, [first, second]))
        users = first.list_users()
        assert len(users) == 1 and users[0]["username"] == "admin" and users[0]["enabled"]
        assert first.login("admin", "admin")[0]["id"] == users[0]["id"]
        events = first.pending_events()
        assert len(events) == 1 and events[0][1]["object_id"] == users[0]["id"]
        assert "password" not in str(events)
        hashed = first._connection().execute("SELECT password_hash FROM users").fetchone()[0]
        assert hashed.startswith("scrypt$") and hashed != "admin"
        with pytest.raises(IdentityError, match="密码长度"):
            first.create_user("other", "admin")
        created = first.create_user("other", "abc123")
        assert first.login("other", "abc123")[0]["id"] == created["id"]
    finally:
        first.close()
        second.close()


def test_default_account_rolls_back_when_audit_outbox_fails(tmp_path, monkeypatch):
    store = IdentityStore(tmp_path / "service.db")

    def fail(*args, **kwargs):
        raise RuntimeError("outbox unavailable")

    try:
        monkeypatch.setattr(store, "_event", fail)
        with pytest.raises(RuntimeError, match="outbox unavailable"):
            store.ensure_default_account()
        assert store.list_users() == []
        assert store.setup_key_path.exists()
    finally:
        store.close()


def test_concurrent_first_startup_handles_setup_key_creation_race(tmp_path, monkeypatch):
    import os
    from pathlib import Path

    # 只预建 schema；两个启动实例同时看到没有用户、没有 setup.key。
    path = tmp_path / "service.db"
    seed = IdentityStore(path)
    seed.close()
    key_path = seed.setup_key_path
    key_path.unlink()
    barrier = Barrier(2)
    original_open = os.open

    def synchronized_open(file, flags, *args, **kwargs):
        if Path(file) == key_path:
            barrier.wait(timeout=5)
        return original_open(file, flags, *args, **kwargs)

    def start(_):
        store = IdentityStore(path)
        try:
            store.ensure_default_account()
            return store.login("admin", "admin")[0]["id"]
        finally:
            store.close()

    monkeypatch.setattr(os, "open", synchronized_open)
    with ThreadPoolExecutor(max_workers=2) as pool:
        user_ids = list(pool.map(start, range(2)))
    assert len(set(user_ids)) == 1
    assert not key_path.exists()
