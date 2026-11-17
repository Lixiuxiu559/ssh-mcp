"""Token 加密副本、后台显式复制及秘密边界的集成验证。"""

import hashlib
import json
import sqlite3
import stat
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from cryptography.fernet import Fernet
from httpx2 import ASGITransport, AsyncClient

from ssh_mcp.auth import IdentityError, IdentityStore


@pytest.fixture
def identity(tmp_path):
    store = IdentityStore(tmp_path / "service.db")
    user = store.initialize("ops", "correct-password", store.setup_key_path.read_text())
    workspace = store.create_workspace("项目 A")
    yield store, user, workspace
    store.close()


@pytest.fixture
async def copy_web(gw):
    gw.state.identity.create_user("alice", "alice-password")
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://t"
    ) as client:
        response = await client.post("/api/auth/login", json={
            "username": "alice", "password": "alice-password",
        })
        assert response.status_code == 200
        client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        yield client


def issue(store, user, workspace, name="codex"):
    return store.create_token(name, user["id"], workspace_id=workspace["id"])


def test_encrypted_copy_survives_reopen_and_never_changes_hash_identity(identity):
    store, user, workspace = identity
    value, item = issue(store, user, workspace)
    assert item["can_copy"] is True
    key_path = store.path.with_suffix(".token.key")
    assert store.token_key_path == key_path
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
    key = key_path.read_bytes()
    row = store._connection().execute("SELECT * FROM tokens WHERE id=?", (item["id"],)).fetchone()
    assert row["token_hash"] == hashlib.sha256(value.encode()).hexdigest()
    assert Fernet(key).decrypt(row["token_ciphertext"]).decode() == value
    assert value not in row["token_ciphertext"]
    assert "token_hash" not in item and "token_ciphertext" not in item
    store.close()
    assert value.encode() not in store.path.read_bytes()

    key_path.chmod(0o644)
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o644
    reopened = IdentityStore(store.path)
    try:
        assert reopened.reveal_token(item["id"]) == value
        assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
        assert reopened.verify_token(value)["id"] == item["id"]
        assert key_path.read_bytes() == key
        reopened.update_token(item["id"], {"enabled": False})
        assert reopened.reveal_token(item["id"]) == value
        assert reopened.verify_token(value) is None
        reopened.delete_token(item["id"])
        assert reopened.token_info(item["id"])["can_copy"] is False
        with pytest.raises(IdentityError, match="已删除"):
            reopened.reveal_token(item["id"])
        row = reopened._connection().execute(
            "SELECT token_hash,token_ciphertext FROM tokens WHERE id=?", (item["id"],)
        ).fetchone()
        assert row["token_ciphertext"] is None
        assert row["token_hash"] == hashlib.sha256(value.encode()).hexdigest()
        assert reopened.token_for_audit(value)["id"] == item["id"]
    finally:
        reopened.close()


def test_hash_only_token_is_not_fabricated_or_recovered(identity):
    store, user, workspace = identity
    value, item = issue(store, user, workspace)
    with store._connection() as conn:
        conn.execute("UPDATE tokens SET token_ciphertext=NULL WHERE id=?", (item["id"],))
    store.token_key_path.unlink()
    store.close()
    reopened = IdentityStore(store.path)
    try:
        assert reopened.token_info(item["id"])["can_copy"] is False
        assert reopened.verify_token(value)["id"] == item["id"]
        with pytest.raises(IdentityError, match="未保存加密副本"):
            reopened.reveal_token(item["id"])
        assert not reopened.token_key_path.exists()
        new_value, new_item = issue(reopened, user, workspace, "new")
        assert reopened.reveal_token(new_item["id"]) == new_value
        assert reopened.token_info(item["id"])["can_copy"] is False
        assert reopened.verify_token(value)["id"] == item["id"]
    finally:
        reopened.close()


@pytest.mark.parametrize("key_state", ["missing", "malformed", "wrong-valid-key"])
def test_lost_or_bad_key_cannot_be_replaced_and_hash_auth_still_works(identity, key_state):
    store, user, workspace = identity
    value, item = issue(store, user, workspace)
    key_path = store.token_key_path
    store.close()
    if key_state == "missing":
        key_path.unlink()
    else:
        key_path.write_bytes(b"broken-key" if key_state == "malformed" else Fernet.generate_key())
    before = key_path.read_bytes() if key_path.exists() else None
    reopened = IdentityStore(store.path)
    try:
        assert reopened.verify_token(value)["id"] == item["id"]
        with pytest.raises(IdentityError, match="密钥|无法解密"):
            reopened.reveal_token(item["id"])
        with pytest.raises(IdentityError, match="密钥"):
            issue(reopened, user, workspace, "must-not-issue")
        assert len(reopened.list_tokens()) == 1
        assert (key_path.read_bytes() if key_path.exists() else None) == before
        assert reopened.verify_token(value)["id"] == item["id"]
    finally:
        reopened.close()


def test_ciphertext_cannot_be_swapped_between_tokens(identity):
    store, user, workspace = identity
    value, first = issue(store, user, workspace, "first")
    other, second = issue(store, user, workspace, "second")
    with store._connection() as conn:
        conn.execute("""UPDATE tokens SET token_ciphertext=(
            SELECT token_ciphertext FROM tokens WHERE id=?) WHERE id=?""",
                     (second["id"], first["id"]))
    with pytest.raises(IdentityError, match="不匹配"):
        store.reveal_token(first["id"])
    assert store.reveal_token(second["id"]) == other
    assert store.verify_token(value)["id"] == first["id"]


def test_first_concurrent_issuance_keeps_one_persistent_private_key(identity):
    store, user, workspace = identity
    assert not store.token_key_path.exists()
    stores = [IdentityStore(store.path) for _ in range(4)]
    barrier = threading.Barrier(len(stores))

    def create(index):
        barrier.wait(timeout=10)
        return issue(stores[index], user, workspace, f"client-{index}")

    try:
        with ThreadPoolExecutor(max_workers=len(stores)) as workers:
            results = list(workers.map(create, range(len(stores))))
        assert stat.S_IMODE(store.token_key_path.stat().st_mode) == 0o600
        for value, item in results:
            assert store.reveal_token(item["id"]) == value
            assert store.verify_token(value)["id"] == item["id"]
    finally:
        for candidate in stores:
            candidate.close()


async def test_copy_http_requires_cookie_and_csrf_and_records_each_result(copy_web, gw, caplog):
    created = await copy_web.post("/api/tokens", json={
        "name": "copy-client", "workspace_id": gw.workspace["id"],
    })
    assert created.status_code == 201
    value, item = created.json()["token"], created.json()["item"]
    assert item["can_copy"] is True
    path = f"/api/tokens/{item['id']}/reveal"
    listed = await copy_web.get("/api/tokens")
    assert listed.status_code == 200
    assert value not in listed.text and "token_ciphertext" not in listed.text
    assert "token_hash" not in listed.text
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://t"
    ) as anonymous:
        for headers in ({}, {"Authorization": f"Bearer {value}"}):
            denied = await anonymous.post(path, headers=headers)
            assert denied.status_code == 401 and value not in denied.text
    for csrf in ("", "wrong"):
        denied = await copy_web.post(path, headers={"X-CSRF-Token": csrf})
        assert denied.status_code == 403 and value not in denied.text
    assert (await copy_web.get(path)).status_code == 405
    copied = await copy_web.post(path)
    assert copied.status_code == 200 and copied.json() == {"token": value}
    assert copied.headers["cache-control"] == "no-store"
    assert copied.headers["x-request-id"]
    disabled = await copy_web.patch(f"/api/tokens/{item['id']}", json={"enabled": False})
    assert disabled.json()["can_copy"] is True and value not in disabled.text
    assert (await copy_web.post(path)).json() == {"token": value}
    assert gw.state.identity.verify_token(value) is None
    assert (await copy_web.delete(f"/api/tokens/{item['id']}")).status_code == 200
    deleted = await copy_web.post(path)
    assert deleted.status_code == 400 and "已删除" in deleted.json()["detail"]
    missing = await copy_web.post("/api/tokens/not-found/reveal")
    assert missing.status_code == 400

    history = await copy_web.get("/api/audit", params={"kind": "person", "q": "token.copy"})
    rows = history.json()["records"]
    assert len(rows) == 8
    assert all(row["action"] == "token.copy" and row["object_type"] == "token" for row in rows)
    rejected = [row for row in rows if row["status"] == "denied"]
    assert len(rejected) == 4
    assert all(row["object_id"] == item["id"] for row in rejected)
    assert all(row["request_id"] and row["source_ip"] for row in rejected)
    anonymous = [row for row in rejected if row["actor_user_id"] is None]
    assert len(anonymous) == 2 and all(row["username"] is None for row in anonymous)
    authenticated = [row for row in rejected if row["actor_user_id"] is not None]
    assert len(authenticated) == 2
    assert all(row["actor_user_id"] == item["created_by"] and row["username"] == "alice"
               for row in authenticated)
    successful = [row for row in rows if row["status"] == "ok"]
    assert len(successful) == 2
    assert all(row["username"] == "alice" and row["object_id"] == item["id"]
               and row["summary"] == "复制 MCP Token" for row in successful)
    ciphertext = gw.state.identity._connection().execute(
        "SELECT token_ciphertext FROM tokens WHERE id=?", (item["id"],)
    ).fetchone()[0]
    assert ciphertext is None
    assert value not in history.text and value not in caplog.text
    assert gw.state.identity.pending_events() == []


async def test_copy_http_old_hash_bad_ciphertext_and_key_errors_are_sanitized(copy_web, gw, caplog):
    created = await copy_web.post("/api/tokens", json={
        "name": "copy-client", "workspace_id": gw.workspace["id"],
    })
    value, item = created.json()["token"], created.json()["item"]
    path = f"/api/tokens/{item['id']}/reveal"
    conn = gw.state.identity._connection()
    ciphertext = conn.execute(
        "SELECT token_ciphertext FROM tokens WHERE id=?", (item["id"],)
    ).fetchone()[0]
    with conn:
        conn.execute("UPDATE tokens SET token_ciphertext=NULL WHERE id=?", (item["id"],))
    assert (await copy_web.post(path)).status_code == 400
    listed = (await copy_web.get("/api/tokens")).json()["tokens"]
    assert next(row for row in listed if row["id"] == item["id"])["can_copy"] is False
    with conn:
        conn.execute("UPDATE tokens SET token_ciphertext=? WHERE id=?", ("not-ciphertext", item["id"]))
    assert (await copy_web.post(path)).status_code == 400
    with conn:
        conn.execute("UPDATE tokens SET token_ciphertext=? WHERE id=?", (ciphertext, item["id"]))
    key_path = gw.state.identity.token_key_path
    key_path.write_bytes(b"broken-key-never-log")
    failed = await copy_web.post(path)
    assert failed.status_code == 400 and "密钥损坏" in failed.json()["detail"]
    denied_creation = await copy_web.post("/api/tokens", json={
        "name": "not-created", "workspace_id": gw.workspace["id"],
    })
    assert denied_creation.status_code == 400
    assert key_path.read_bytes() == b"broken-key-never-log"
    assert gw.state.identity.verify_token(value)["id"] == item["id"]
    history = await copy_web.get("/api/audit", params={"kind": "person", "q": "token.copy"})
    rows = history.json()["records"]
    assert len(rows) == 3 and all(row["status"] == "error" for row in rows)
    assert all(row["object_id"] == item["id"] for row in rows)
    combined = json.dumps([rows, failed.json(), denied_creation.json()]) + caplog.text
    assert value not in combined and ciphertext not in combined and "broken-key-never-log" not in combined


async def test_copy_decrypts_outside_event_loop(copy_web, gw, monkeypatch):
    token = gw.state.identity.verify_token(gw.tokens["alice"])
    original = gw.state.identity.reveal_token
    event_thread = threading.get_ident()
    used_threads = []

    def reveal(token_id, event=None):
        used_threads.append(threading.get_ident())
        return original(token_id, event)

    monkeypatch.setattr(gw.state.identity, "reveal_token", reveal)
    response = await copy_web.post(f"/api/tokens/{token['id']}/reveal")
    assert response.json() == {"token": gw.tokens["alice"]}
    assert len(used_threads) == 1 and used_threads[0] != event_thread


async def test_copy_keeps_outbox_until_failed_audit_delivery_recovers(copy_web, gw, monkeypatch):
    token = gw.state.identity.verify_token(gw.tokens["alice"])
    value = gw.tokens["alice"]

    async def unavailable(record):
        return False

    with monkeypatch.context() as patched:
        patched.setattr(gw.state.audit, "log_person", unavailable)
        response = await copy_web.post(f"/api/tokens/{token['id']}/reveal")
        assert response.status_code == 200 and response.json() == {"token": value}
        pending = gw.state.identity.pending_events()
        assert len(pending) == 1
        record = pending[0][1]
        assert record["action"] == "token.copy" and record["status"] == "ok"
        assert record["object_id"] == token["id"] and record["username"] == "alice"
        assert value not in json.dumps(pending)
        # The successful copy remains durably recoverable even across store reopen.
        reopened = IdentityStore(gw.state.identity.path)
        try:
            assert reopened.pending_events() == pending
        finally:
            reopened.close()
        assert gw.state.audit.query(kind="person", q="token.copy")[1] == 0

    await gw.state.flush_identity_events()
    assert gw.state.identity.pending_events() == []
    rows, total = gw.state.audit.query(kind="person", q="token.copy")
    assert total == 1 and rows[0]["event_id"] == record["event_id"]
    assert rows[0]["status"] == "ok" and value not in json.dumps(rows)
    await gw.state.flush_identity_events()
    assert gw.state.audit.query(kind="person", q="token.copy")[1] == 1


async def test_copy_returns_no_secret_when_identity_outbox_cannot_commit(copy_web, gw, monkeypatch):
    token = gw.state.identity.verify_token(gw.tokens["alice"])
    value = gw.tokens["alice"]
    original = gw.state.identity._event

    def fail_after_insert(*args, **kwargs):
        original(*args, **kwargs)
        raise sqlite3.OperationalError("simulated outbox commit failure")

    with monkeypatch.context() as patched:
        patched.setattr(gw.state.identity, "_event", fail_after_insert)
        response = await copy_web.post(f"/api/tokens/{token['id']}/reveal")
    assert response.status_code == 500 and value not in response.text
    assert gw.state.identity.pending_events() == []
    rows, total = gw.state.audit.query(kind="person", q="token.copy")
    assert total == 1 and rows[0]["status"] == "error"
    assert value not in json.dumps(rows)
    recovered = await copy_web.post(f"/api/tokens/{token['id']}/reveal")
    assert recovered.status_code == 200 and recovered.json() == {"token": value}
