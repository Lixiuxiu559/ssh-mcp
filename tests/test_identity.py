"""身份迁移、独立凭证、持久化与事务审计场景。"""

import sqlite3
from pathlib import Path

import pytest

from ssh_mcp.auth import IdentityError, IdentityStore
from ssh_mcp.auth.verifier import StoreTokenVerifier
from ssh_mcp.config import UserEntry


def setup_store(tmp_path):
    store = IdentityStore(tmp_path / "data" / "service.db")
    user = store.initialize("ops", "correct-password", store.setup_key_path.read_text())
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
    value, item = store.create_token("codex", user["id"])
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
    value, _ = store.create_token("machine", second["id"])
    store.update_user(second["id"], {"enabled": False})
    assert store.session(session) is None
    assert store.verify_token(value) is not None  # independent lifecycle
    with pytest.raises(IdentityError, match="最后一个"):
        store.update_user(first["id"], {"enabled": False})
    assert all("admin" not in row for row in store.list_users())


async def test_legacy_tokens_import_once_and_survive_restart(tmp_path):
    path = tmp_path / "service.db"
    users = [
        UserEntry(username="legacy", token="original-token"),
        UserEntry(username="admin", token="admin", admin=True),
    ]
    store = IdentityStore(path)
    store.migrate_legacy(users)
    item = store.verify_token("original-token")
    assert item["legacy"] and store.verify_token("admin") is not None
    verifier = StoreTokenVerifier(store)
    access = await verifier.verify_token("original-token")
    assert access.client_id == item["id"]
    assert access.claims["token_name"] == "legacy:legacy"
    store.close()
    reopened = IdentityStore(path)
    reopened.migrate_legacy(users)
    assert reopened.verify_token("original-token")["id"] == item["id"]
    reopened.revoke_token(item["id"])
    reopened.close()
    reopened = IdentityStore(path)
    reopened.migrate_legacy(users)
    assert reopened.verify_token("original-token") is None
    assert len(reopened.list_tokens()) == 2


def test_new_old_tokens_parallel_and_revocation_is_final(tmp_path):
    store, user = setup_store(tmp_path)
    old, first = store.create_token("old", user["id"])
    new, second = store.create_token("new", user["id"])
    assert store.verify_token(old) and store.verify_token(new)
    store.update_token(first["id"], {"enabled": False})
    assert store.verify_token(old) is None
    store.update_token(first["id"], {"enabled": True, "name": "renamed"})
    assert store.verify_token(old)["id"] == first["id"]
    store.revoke_token(first["id"])
    with pytest.raises(IdentityError, match="吊销"):
        store.update_token(first["id"], {"enabled": True})
    assert store.verify_token(new)["id"] == second["id"]


def test_identity_mutation_and_audit_outbox_are_atomic(tmp_path, monkeypatch):
    store, user = setup_store(tmp_path)
    event = {"event_id": "evt-1", "action": "token.create", "actor_user_id": user["id"]}
    value, item = store.create_token("machine", user["id"], event=event)
    records = store.pending_events()
    assert len(records) == 1 and records[0][1]["object_id"] == item["id"]
    original = store._event

    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "_event", fail)
    with pytest.raises(sqlite3.OperationalError):
        store.create_token("must-rollback", user["id"], event={"action": "token.create"})
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
    value, token = store.create_token("machine", user["id"])
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
