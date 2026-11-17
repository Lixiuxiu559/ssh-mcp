"""身份迁移、独立凭证、持久化与事务审计场景。"""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from ssh_mcp.auth import IdentityError, IdentityStore
from ssh_mcp.auth.verifier import StoreTokenVerifier


def setup_store(tmp_path):
    store = IdentityStore(tmp_path / "data" / "service.db")
    user = store.initialize("ops", "correct-password", store.setup_key_path.read_text())
    store.test_workspace_id = store.create_workspace("测试空间")["id"]
    return store, user


def test_setup_requires_local_key_and_never_default_admin(tmp_path):
    store = IdentityStore(tmp_path / "service.db")
    assert store.setup_required
    assert store.verify_token("admin") is None
    with pytest.raises(IdentityError, match="初始化凭证"):
        store.initialize("ops", "correct-password", "wrong")
    with pytest.raises(IdentityError, match="密码长度"):
        store.initialize("ops", "short", store.setup_key_path.read_text())
    store.initialize("ops", "correct-password", store.setup_key_path.read_text())
    assert not store.setup_required
    assert not store.setup_key_path.exists()
    with pytest.raises(IdentityError, match="初始化已经完成"):
        store.initialize("other", "correct-password", "ignored")


def test_password_hash_session_and_token_are_separate(tmp_path):
    store, user = setup_store(tmp_path)
    value, item = store.create_token("codex", user["id"], workspace_id=store.test_workspace_id)
    logged, session, csrf = store.login("ops", "correct-password")
    assert logged["id"] == user["id"] and len(csrf) > 30
    assert store.session(session)[0]["id"] == user["id"]
    assert store.session(value) is None
    assert store.verify_token(session) is None
    assert store.verify_token("correct-password") is None
    assert store.verify_token(value)["id"] == item["id"]
    with pytest.raises(IdentityError, match="用户名或密码"):
        store.login("ops", value)
    store.close()
    content = (tmp_path / "data" / "service.db").read_bytes()
    assert b"correct-password" not in content
    assert value.encode() not in content
    assert session.encode() not in content


def test_users_same_capabilities_last_user_and_sessions(tmp_path):
    store, first = setup_store(tmp_path)
    second = store.create_user("second", "second-password", "Second")
    _, session, _ = store.login("second", "second-password")
    store.update_user(second["id"], {"password": "replacement-password"})
    assert store.session(session) is None
    _, session, _ = store.login("second", "replacement-password")
    value, _ = store.create_token("machine", second["id"], workspace_id=store.test_workspace_id)
    store.update_user(second["id"], {"enabled": False})
    assert store.session(session) is None
    assert store.verify_token(value) is not None  # independent lifecycle
    with pytest.raises(IdentityError, match="最后一个"):
        store.update_user(first["id"], {"enabled": False})
    assert all("admin" not in row for row in store.list_users())


def test_delete_user_revokes_sessions_preserves_tokens_and_identity_history(tmp_path):
    store, first = setup_store(tmp_path)
    second = store.create_user("second", "second-password")
    _, first_session, _ = store.login("ops", "correct-password")
    _, session, _ = store.login("second", "second-password")
    _, other_session, _ = store.login("second", "second-password")
    value, token = store.create_token("machine", second["id"], workspace_id=store.test_workspace_id)
    event = {"event_id": "delete-member-1", "action": "user.delete", "status": "ok",
             "actor_user_id": first["id"], "username": first["username"], "object_type": "user"}

    store.delete_user(second["id"], event)

    assert [row["id"] for row in store.list_users()] == [first["id"]]
    assert store.session(session) is None and store.session(other_session) is None
    assert store.session(first_session)[0]["id"] == first["id"]
    with pytest.raises(IdentityError, match="用户名或密码"):
        store.login("second", "second-password")
    assert store.verify_token(value)["id"] == token["id"]
    assert store.token_info(token["id"])["created_by"] == second["id"]
    assert event["object_id"] == second["id"] and "second" in event["summary"]
    pending = store.pending_events()
    assert len(pending) == 1 and pending[0][1] == event
    assert pending[0][1]["actor_user_id"] == first["id"]
    assert value not in str(pending) and session not in str(pending)
    with pytest.raises(IdentityError, match="用户不存在"):
        store.update_user(second["id"], {"enabled": True})

    store.close()
    reopened = IdentityStore(store.path)
    assert not reopened.setup_required
    assert reopened.verify_token(value)["id"] == token["id"]
    replacement = reopened.create_user("second", "replacement-password")
    assert replacement["id"] != second["id"]
    assert reopened.session(session) is None
    reopened.close()


def test_delete_user_protects_last_enabled_account_and_allows_disabled_deletion(tmp_path):
    store, first = setup_store(tmp_path)
    second = store.create_user("second", "second-password")
    store.update_user(second["id"], {"enabled": False})
    with pytest.raises(IdentityError, match="最后一个"):
        store.delete_user(first["id"])
    store.delete_user(second["id"])
    assert [row["id"] for row in store.list_users()] == [first["id"]]


def test_delete_user_rolls_back_sessions_and_account_when_outbox_fails(tmp_path, monkeypatch):
    store, _ = setup_store(tmp_path)
    second = store.create_user("second", "second-password")
    _, session, _ = store.login("second", "second-password")

    original = store._event

    def fail_event(*args, **kwargs):
        original(*args, **kwargs)
        raise sqlite3.OperationalError("simulated outbox failure")

    with monkeypatch.context() as patched:
        patched.setattr(store, "_event", fail_event)
        with pytest.raises(sqlite3.OperationalError, match="outbox"):
            store.delete_user(second["id"], {"action": "user.delete"})
    assert store.session(session)[0]["id"] == second["id"]
    assert second["id"] in {row["id"] for row in store.list_users()}
    assert store.pending_events() == []
    store.delete_user(second["id"], {"action": "user.delete"})
    events = store.pending_events()
    assert len(events) == 1 and events[0][1]["object_id"] == second["id"]
    assert store.session(session) is None


@pytest.mark.parametrize("operations", [("delete", "delete"), ("delete", "disable"),
                                         ("disable", "disable")])
def test_concurrent_user_deletion_keeps_one_enabled_account(tmp_path, operations):
    store, first = setup_store(tmp_path)
    second = store.create_user("second", "second-password")

    barrier = threading.Barrier(2)

    def remove(arguments):
        user_id, operation = arguments
        connection = IdentityStore(store.path)
        try:
            barrier.wait(timeout=10)
            if operation == "delete":
                connection.delete_user(user_id)
            else:
                connection.update_user(user_id, {"enabled": False})
            return True
        except IdentityError as error:
            assert "最后一个" in str(error)
            return False
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as workers:
        assert sorted(workers.map(remove, zip([first["id"], second["id"]], operations))) == [False, True]
    assert sum(user["enabled"] for user in store.list_users()) == 1


async def test_unbound_tokens_are_rejected_without_automatic_workspace(tmp_path):
    store, user = setup_store(tmp_path)
    value, item = store.create_token("bound", user["id"], workspace_id=store.test_workspace_id)
    with store._connection() as conn:
        conn.execute("UPDATE tokens SET workspace_id=NULL WHERE id=?", (item["id"],))
    assert store.verify_token(value) is None
    assert await StoreTokenVerifier(store).verify_token(value) is None
    store.close()
    reopened = IdentityStore(store.path)
    assert reopened.verify_token(value) is None
    assert len(reopened.list_workspaces()) == 1
    assert reopened.token_info(item["id"])["workspace_id"] is None
    reopened.close()


def test_new_old_tokens_parallel_and_revocation_is_final(tmp_path):
    store, user = setup_store(tmp_path)
    old, first = store.create_token("old", user["id"], workspace_id=store.test_workspace_id)
    new, second = store.create_token("new", user["id"], workspace_id=store.test_workspace_id)
    assert store.verify_token(old) and store.verify_token(new)
    store.update_token(first["id"], {"enabled": False})
    assert store.verify_token(old) is None
    store.update_token(first["id"], {"enabled": True, "name": "renamed"})
    assert store.verify_token(old)["id"] == first["id"]
    store.revoke_token(first["id"])
    with pytest.raises(IdentityError, match="不能重新启用"):
        store.update_token(first["id"], {"enabled": True})
    assert store.verify_token(new)["id"] == second["id"]


def test_delete_token_hides_metadata_and_cannot_be_reimported(tmp_path):
    store, user = setup_store(tmp_path)
    value, item = store.create_token("machine", user["id"], workspace_id=store.test_workspace_id)
    retained, other = store.create_token("other", user["id"], workspace_id=store.test_workspace_id)
    event = {"event_id": "delete-1", "action": "token.delete", "actor_user_id": user["id"]}
    store.delete_token(item["id"], event)
    assert store.verify_token(value) is None
    assert store.list_tokens(include_deleted=False) == [other]
    assert store.token_for_audit(value)["id"] == item["id"]
    assert store.pending_events()[0][1]["object_id"] == item["id"]
    store.delete_token(item["id"])
    with pytest.raises(IdentityError, match="已删除"):
        store.update_token(item["id"], {"enabled": True})
    store.close()

    reopened = IdentityStore(store.path)
    assert reopened.verify_token(value) is None
    assert reopened.verify_token(retained)["id"] == other["id"]
    assert [row["id"] for row in reopened.list_tokens(include_deleted=False)] == [other["id"]]
    assert len(reopened.list_tokens()) == 2
    assert reopened.token_info(item["id"])["revoked"] is True
    reopened.close()


def test_delete_token_rolls_back_if_audit_outbox_fails(tmp_path, monkeypatch):
    store, user = setup_store(tmp_path)
    value, item = store.create_token("machine", user["id"], workspace_id=store.test_workspace_id)
    original = store._event

    def fail(conn, record, **kwargs):
        original(conn, record, **kwargs)
        raise sqlite3.OperationalError("disk full")

    with monkeypatch.context() as patched:
        patched.setattr(store, "_event", fail)
        with pytest.raises(sqlite3.OperationalError):
            store.delete_token(item["id"], {"event_id": "failed-delete", "action": "token.delete"})
    assert store.verify_token(value)["id"] == item["id"]
    assert store.list_tokens(include_deleted=False)[0]["id"] == item["id"]
    assert store.pending_events() == []
    store.delete_token(item["id"], {"event_id": "retry-delete", "action": "token.delete"})
    assert store.verify_token(value) is None
    assert len(store.pending_events()) == 1
    store.close()


def test_identity_mutation_and_audit_outbox_are_atomic(tmp_path, monkeypatch):
    store, user = setup_store(tmp_path)
    event = {"event_id": "evt-1", "action": "token.create", "actor_user_id": user["id"]}
    value, item = store.create_token("machine", user["id"], event=event, workspace_id=store.test_workspace_id)
    records = store.pending_events()
    assert len(records) == 1 and records[0][1]["object_id"] == item["id"]
    original = store._event

    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "_event", fail)
    with pytest.raises(sqlite3.OperationalError):
        store.create_token("must-rollback", user["id"], event={"action": "token.create"}, workspace_id=store.test_workspace_id)
    assert len(store.list_tokens()) == 1
    monkeypatch.setattr(store, "_event", original)
    store.acknowledge_event(records[0][0])
    assert store.pending_events() == []
    assert store.verify_token(value)


def test_existing_shared_directory_does_not_expose_sqlite_sidecars(tmp_path):
    import os
    import stat

    directory = tmp_path / "existing"
    directory.mkdir(mode=0o755)
    path = directory / "service.db"
    old_umask = os.umask(0o022)
    try:
        store = IdentityStore(path)
        store.initialize("ops", "correct-password", store.setup_key_path.read_text())
        for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
            assert candidate.exists()
            assert stat.S_IMODE(candidate.stat().st_mode) == 0o600
        assert stat.S_IMODE(directory.stat().st_mode) == 0o755
        # Repair files left permissive by an earlier version, without changing the directory.
        for suffix in ("", "-wal", "-shm"):
            os.chmod(Path(str(path) + suffix), 0o644)
        reopened = IdentityStore(path)
        for suffix in ("", "-wal", "-shm"):
            assert stat.S_IMODE(Path(str(path) + suffix).stat().st_mode) == 0o600
        assert stat.S_IMODE(directory.stat().st_mode) == 0o755
        reopened.close()
        store.close()
    finally:
        os.umask(old_umask)


async def test_rejected_mcp_auth_is_audited_without_received_credential(tmp_path):
    import json

    from ssh_mcp.audit import AuditLogger

    store, user = setup_store(tmp_path)
    audit = AuditLogger(tmp_path / "audit.db")
    verifier = StoreTokenVerifier(store, audit)
    value, token = store.create_token("machine", user["id"], workspace_id=store.test_workspace_id)
    assert await verifier.verify_token(value) is not None
    used = store.token_info(token["id"])["last_used_at"]
    store.update_token(token["id"], {"enabled": False})
    assert await verifier.verify_token(value) is None
    assert store.token_info(token["id"])["last_used_at"] == used
    assert await verifier.verify_token("unknown-credential-never-log") is None
    rows, total = audit.query(status="denied")
    assert total == 2
    assert {row["token_id"] for row in rows} == {token["id"], None}
    serialized = json.dumps(rows)
    assert value not in serialized and "unknown-credential-never-log" not in serialized
    store.close()
    audit.close()


async def test_person_begin_finish_preserve_start_and_outbox_idempotence(tmp_path):
    from ssh_mcp.audit import AuditLogger

    audit = AuditLogger(tmp_path / "audit.db")
    record = {
        "event_id": "external-1",
        "action": "server.update",
        "username": "ops",
        "summary": "配置变更开始",
    }
    assert await audit.begin_person(record)
    started = audit.query(kind="person")[0][0]
    assert started["status"] == "running"
    assert await audit.finish_person({**record, "status": "ok", "summary": "保存完成"})
    assert await audit.log_person(
        {**record, "status": "error", "summary": "重复outbox不可覆盖终态"}
    )
    terminal = audit.query(kind="person")[0][0]
    assert terminal["ts"] == started["ts"]
    assert terminal["status"] == "ok" and terminal["summary"] == "保存完成"
    assert await audit.finish_person({"event_id": "never-started", "status": "ok"})
    assert audit.query(kind="person")[1] == 1
    audit.close()


def test_existing_unbound_schema_and_static_config_grant_no_access(tmp_path):
    import hashlib

    import yaml

    from ssh_mcp.config import ConfigFile
    from ssh_mcp.server import create_mcp

    path = tmp_path / "service.db"
    old_value = "existing-unbound-test-credential"
    with sqlite3.connect(path) as conn:
        conn.execute("""CREATE TABLE tokens (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
            prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
            created_by TEXT, created_at TEXT NOT NULL, last_used_at TEXT,
            legacy INTEGER NOT NULL DEFAULT 0)""")
        conn.execute("INSERT INTO tokens VALUES(?,?,?,?,?,1,0,?,?,NULL,1)", (
            "old-id", "old-token", "keep this record", "old-prefix",
            hashlib.sha256(old_value.encode()).hexdigest(), "old-creator", "2026-01-01"))
    config = tmp_path / "config.yaml"
    config.write_text(yaml.safe_dump({"auth": {"database": "service.db", "users": [
        {"username": "old-static-user", "token": "static-must-not-import", "admin": True}
    ]}, "servers": [{"alias": "unassigned", "host": "example.invalid", "username": "ops",
                         "credential": {"type": "password", "password": "test-only"}}]}))
    _mcp, state = create_mcp(ConfigFile(config))
    assert state.identity.list_workspaces() == []
    assert state.identity.verify_token(old_value) is None
    assert state.identity.verify_token("static-must-not-import") is None
    assert len(state.identity.list_tokens()) == 1
    assert state.identity.token_info("old-id")["workspace_id"] is None
    assert state.config.get_server("unassigned").workspace_ids == []
    assert not state.identity.setup_required
    assert [user["username"] for user in state.identity.list_users()] == ["admin"]
    state.identity.close()
    state.audit.close()
