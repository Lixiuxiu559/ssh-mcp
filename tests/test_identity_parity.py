"""两服务统一的账号、字段、会话及复制边界在 SSH 中的行为回归。"""

import json
import time
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie

import pytest
import yaml
from httpx2 import ASGITransport, AsyncClient
from pydantic import ValidationError

from ssh_mcp.auth import IdentityError, IdentityStore
from ssh_mcp.auth import store as identity_module
from ssh_mcp.config import AuthConfig, ConfigFile
from ssh_mcp.server import create_mcp


@asynccontextmanager
async def signed_in(app, username="admin", password="admin"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as web:
        response = await web.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        assert response.status_code == 200, response.text
        web.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        yield web


@pytest.mark.parametrize("operation", ["create", "reset", "self"])
@pytest.mark.parametrize("length", [5, 6, 1024, 1025])
async def test_password_api_boundaries_keep_failed_mutations_atomic(gw, operation, length):
    identity = gw.state.identity
    actor = identity.create_user("actor", "actor-original")
    target = identity.create_user("target", "target-original")
    _, target_session, _ = identity.login("target", "target-original")
    app = gw.mcp.http_app()
    async with signed_in(app, "actor", "actor-original") as web:
        before_users = identity.list_users()
        sessions = list(
            identity._connection().execute("SELECT * FROM sessions ORDER BY session_hash")
        )
        password = "a" * length
        if operation == "create":
            response = await web.post(
                "/api/users", json={"username": "new-user", "password": password}
            )
        else:
            user_id = actor["id"] if operation == "self" else target["id"]
            response = await web.patch(f"/api/users/{user_id}", json={"password": password})
        if length in (5, 1025):
            assert response.status_code == 400
            assert identity.list_users() == before_users
            assert (
                list(identity._connection().execute("SELECT * FROM sessions ORDER BY session_hash"))
                == sessions
            )
            assert identity.pending_events() == []
            assert (await web.get("/api/me")).status_code == 200
            rows, _ = gw.state.audit.query(
                kind="person", q="user.create" if operation == "create" else "user.update"
            )
            assert len(rows) == 1 and rows[0]["status"] == "error"
        else:
            assert response.status_code == (201 if operation == "create" else 200)
            username = (
                "new-user"
                if operation == "create"
                else ("actor" if operation == "self" else "target")
            )
            assert identity.login(username, password)[0]["username"] == username
            if operation == "self":
                assert (await web.get("/api/me")).status_code == 401
            elif operation == "reset":
                assert identity.session(target_session) is None
                assert (await web.get("/api/me")).status_code == 200
            assert identity.pending_events() == []


@pytest.mark.parametrize("operation", ["password", "disable", "delete"])
def test_all_target_sessions_revoke_without_harming_another_person_or_token(tmp_path, operation):
    store = IdentityStore(tmp_path / "service.db")
    try:
        store.ensure_default_account()
        a = store.list_users()[0]
        b = store.create_user("person-b", "original-password")
        workspace = store.create_workspace("project")
        _, a_session, _ = store.login("admin", "admin")
        b_sessions = [store.login("person-b", "original-password")[1] for _ in range(2)]
        value, token = store.create_token("independent", b["id"], workspace_id=workspace["id"])
        if operation == "delete":
            store.delete_user(b["id"])
            replacement = store.create_user("person-b", "replacement-password")
            assert replacement["id"] != b["id"]
        elif operation == "disable":
            store.update_user(b["id"], {"enabled": False})
            with pytest.raises(IdentityError):
                store.login("person-b", "original-password")
            store.update_user(b["id"], {"enabled": True})
        else:
            store.update_user(b["id"], {"password": "replacement-password"})
        assert all(store.session(session) is None for session in b_sessions)
        assert store.session(a_session)[0]["id"] == a["id"]
        assert store.verify_token(value)["id"] == token["id"]
        assert store.token_info(token["id"])["created_by"] == b["id"]
    finally:
        store.close()


async def test_web_session_exact_deadline_survives_full_service_restart(gw, monkeypatch):
    clock = [time.time()]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    app = gw.mcp.http_app()
    async with signed_in(app) as original:
        cookie = original.cookies.get("ssh_mcp_session")
        csrf = original.headers["X-CSRF-Token"]
        deadline = (
            gw.state.identity._connection().execute("SELECT expires_at FROM sessions").fetchone()[0]
        )
        await gw.state.shutdown()
        restarted, state = create_mcp(ConfigFile(gw.config_path))
        try:
            async with AsyncClient(
                transport=ASGITransport(app=restarted.http_app()),
                base_url="http://localhost",
                cookies={"ssh_mcp_session": cookie},
                headers={"X-CSRF-Token": csrf},
            ) as web:
                assert (
                    state.identity._connection()
                    .execute("SELECT expires_at FROM sessions")
                    .fetchone()[0]
                    == deadline
                )
                clock[0] = deadline - 0.001
                assert (await web.get("/api/me")).status_code == 200
                before = state.identity.list_users()
                for now in (deadline, deadline + 1):
                    clock[0] = now
                    assert (await web.get("/api/me")).status_code == 401
                    assert (
                        await web.post(
                            "/api/users",
                            json={"username": "must-not-create", "password": "secret123"},
                        )
                    ).status_code == 401
                    assert state.identity.list_users() == before
                assert state.identity.session(cookie) is None
        finally:
            await state.shutdown()


class StripGatewayPrefix:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        assert scope["path"].startswith("/example/")
        scope = {
            **scope,
            "path": scope["path"][len("/example") :],
            "raw_path": scope["raw_path"][len(b"/example") :],
        }
        await self.app(scope, receive, send)


async def test_cookie_secure_path_lifetime_and_logout_through_stripping_gateway(tmp_path):
    config = tmp_path / "config.yaml"
    config.write_text(
        yaml.safe_dump(
            {
                "auth": {
                    "database": "service.db",
                    "cookie_secure": True,
                    "cookie_path": "/example/",
                    "session_hours": 1,
                },
                "audit": {"path": str(tmp_path / "audit.db")},
            }
        )
    )
    mcp, state = create_mcp(ConfigFile(config))
    try:
        app = StripGatewayPrefix(mcp.http_app())
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="https://gateway.invalid"
        ) as web:
            response = await web.post(
                "/example/api/auth/login", json={"username": "admin", "password": "admin"}
            )
            assert response.status_code == 200
            cookie = SimpleCookie(response.headers["set-cookie"])["ssh_mcp_session"]
            assert cookie["httponly"] and cookie["secure"] and cookie["samesite"] == "strict"
            assert cookie["path"] == "/example/" and cookie["max-age"] == "3600"
            session = cookie.value
            assert (await web.get("/example/api/me")).status_code == 200
            denied = await web.post("/example/api/auth/logout")
            assert denied.status_code == 403 and state.identity.session(session)
            web.headers["X-CSRF-Token"] = response.json()["csrf_token"]
            logged_out = await web.post("/example/api/auth/logout")
            cleared = SimpleCookie(logged_out.headers["set-cookie"])["ssh_mcp_session"]
            assert cleared["path"] == "/example/" and cleared["max-age"] == "0"
            assert state.identity.session(session) is None
            assert (await web.get("/example/api/me")).status_code == 401
    finally:
        await state.shutdown()


@pytest.mark.parametrize("hours", [1, 168])
def test_session_configuration_accepts_lifetime_boundaries(hours):
    assert AuthConfig(session_hours=hours, cookie_path="/example/").session_hours == hours


@pytest.mark.parametrize(
    "settings",
    [
        {"session_hours": 0},
        {"session_hours": 169},
        {"cookie_path": "/example"},
        {"cookie_path": "example/"},
    ],
)
def test_session_configuration_rejects_invalid_lifetime_and_path(settings):
    with pytest.raises(ValidationError):
        AuthConfig(**settings)


async def test_failed_login_preserves_state_and_records_attempt_without_authenticated_actor(
    gw, caplog
):
    store = gw.state.identity
    store.create_user("enabled-person", "correct-credential-never-log")
    disabled = store.create_user("disabled-person", "disabled-credential-never-log")
    store.login("enabled-person", "correct-credential-never-log")
    store.update_user(disabled["id"], {"enabled": False})
    before_users = store.list_users()
    before_sessions = list(
        store._connection().execute("SELECT * FROM sessions ORDER BY session_hash")
    )
    attempts = [
        ("missing-person", "unknown-credential-never-log"),
        ("enabled-person", "wrong-credential-never-log"),
        ("disabled-person", "disabled-credential-never-log"),
    ]
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://localhost"
    ) as web:
        for username, password in attempts:
            response = await web.post(
                "/api/auth/login", json={"username": username, "password": password}
            )
            assert response.status_code == 401
            assert "set-cookie" not in response.headers
            assert store.list_users() == before_users
            assert (
                list(store._connection().execute("SELECT * FROM sessions ORDER BY session_hash"))
                == before_sessions
            )
        for body in (
            {"username": [], "password": "typed-secret-never-log"},
            {"username": "enabled-person", "password": {"secret": "invalid-type"}},
        ):
            assert (await web.post("/api/auth/login", json=body)).status_code == 400
        rows, total = gw.state.audit.query(kind="person", q="user.login")
        assert total == 5
        assert all(row["actor_user_id"] is None and row["status"] == "error" for row in rows)
        assert all(row["request_id"] and row["source_ip"] for row in rows)
        assert {row["username"] for row in rows} == {
            "missing-person",
            "enabled-person",
            "disabled-person",
            None,
        }
        serialized = json.dumps(rows) + caplog.text
        assert all(password not in serialized for _, password in attempts)
        assert "typed-secret-never-log" not in serialized and "invalid-type" not in serialized
        assert store.pending_events() == []


def test_recent_login_and_token_usage_advance_only_for_successful_authentication(
    tmp_path, monkeypatch
):
    store = IdentityStore(tmp_path / "service.db")
    try:
        store.ensure_default_account()
        user = store.list_users()[0]
        workspace = store.create_workspace("project")
        value, token = store.create_token("client", user["id"], workspace_id=workspace["id"])
        assert user["last_login_at"] is None and token["last_used_at"] is None

        clock = 0

        def advance_time():
            nonlocal clock
            clock += 1
            stamp = f"2030-01-01T00:00:{clock:02d}.000+00:00"
            monkeypatch.setattr(identity_module, "_now", lambda: stamp)
            return stamp

        def assert_persisted_times(last_login, last_used):
            conn = store._connection()
            assert conn.execute(
                "SELECT last_login_at FROM users WHERE id=?", (user["id"],)
            ).fetchone()[0] == last_login
            assert conn.execute(
                "SELECT last_used_at FROM tokens WHERE id=?", (token["id"],)
            ).fetchone()[0] == last_used

        last_login, last_used = None, None
        for _ in range(2):
            last_login = advance_time()
            store.login("admin", "admin")
            assert_persisted_times(last_login, last_used)
            last_used = advance_time()
            store.verify_token(value)
            assert_persisted_times(last_login, last_used)
            for operation in (
                lambda: store.reveal_token(token["id"]),
                store.list_tokens,
                lambda: store.token_info(token["id"]),
                lambda: store.active_token_info(token["id"]),
                lambda: store.token_for_audit(value),
                store.list_users,
            ):
                advance_time()
                operation()
                assert_persisted_times(last_login, last_used)
        advance_time()
        with pytest.raises(IdentityError):
            store.login("admin", "wrong")
        assert_persisted_times(last_login, last_used)
        advance_time()
        store.update_token(token["id"], {"enabled": False})
        assert_persisted_times(last_login, last_used)
        for credential in (value, "unknown"):
            advance_time()
            assert store.verify_token(credential) is None
            assert_persisted_times(last_login, last_used)
    finally:
        store.close()


async def test_workspace_token_inputs_and_repeated_binding_patch_are_atomic(gw):
    store = gw.state.identity
    async with signed_in(gw.mcp.http_app()) as web:
        before = store.list_tokens()
        for body in (
            {},
            {"workspace_id": "not-found"},
            {"workspace_id": [gw.workspace["id"]]},
            {"workspace_id": None},
            {"workspace_id": 1},
        ):
            response = await web.post("/api/tokens", json={"name": "invalid-binding", **body})
            assert response.status_code == 400
            assert store.list_tokens() == before and store.pending_events() == []
        other = store.create_workspace("other")
        token = before[0]
        for workspace_id in (token["workspace_id"], other["id"]):
            response = await web.patch(
                f"/api/tokens/{token['id']}", json={"workspace_id": workspace_id}
            )
            assert response.status_code == 400
            assert store.token_info(token["id"]) == token and store.pending_events() == []
        rows, _ = gw.state.audit.query(kind="person", q="token.")
        assert len(rows) == 7 and all(row["status"] == "error" for row in rows)


async def test_full_service_restart_allows_another_person_to_copy_disabled_token(gw):
    store = gw.state.identity
    creator = store.create_user("creator", "creator-password")
    reader = store.create_user("reader", "reader-password")
    value, token = store.create_token(
        "copy-after-restart", creator["id"], workspace_id=gw.workspace["id"]
    )
    store.update_token(token["id"], {"enabled": False})
    key = store.token_key_path.read_bytes()
    await gw.state.shutdown()
    restarted, state = create_mcp(ConfigFile(gw.config_path))
    try:
        async with signed_in(restarted.http_app(), "reader", "reader-password") as web:
            path = f"/api/tokens/{token['id']}"
            copied = await web.post(path + "/reveal")
            assert copied.status_code == 200 and copied.json() == {"token": value}
            assert copied.headers["cache-control"] == "no-store"
            assert state.identity.verify_token(value) is None
            assert state.identity.token_key_path.read_bytes() == key
            records, total = state.audit.query(kind="person", q="token.copy")
            assert total == 1 and records[0]["actor_user_id"] == reader["id"]
            assert records[0]["object_id"] == token["id"] and records[0]["status"] == "ok"
            assert (await web.patch(path, json={"enabled": True})).status_code == 200
            assert state.identity.verify_token(value)["id"] == token["id"]
            assert (await web.delete(path)).status_code == 200
            assert (await web.post(path + "/reveal")).status_code == 400
            assert state.identity.token_for_audit(value)["id"] == token["id"]
    finally:
        await state.shutdown()


async def test_password_api_old_new_login_and_last_enabled_with_disabled_member(gw):
    store = gw.state.identity
    person = store.create_user("ordinary", "original-password")
    default = store.list_users()[0]
    store.update_user(default["id"], {"enabled": False})
    app = gw.mcp.http_app()
    async with signed_in(app, "ordinary", "original-password") as web:
        assert (
            await web.patch(f"/api/users/{person['id']}", json={"password": "changed-password"})
        ).status_code == 200
        assert (await web.get("/api/me")).status_code == 401
        assert (
            await web.post(
                "/api/auth/login", json={"username": "ordinary", "password": "original-password"}
            )
        ).status_code == 401
        response = await web.post(
            "/api/auth/login", json={"username": "ordinary", "password": "changed-password"}
        )
        assert response.status_code == 200
        web.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        assert (await web.delete(f"/api/users/{person['id']}")).status_code == 400
        assert (
            await web.patch(f"/api/users/{person['id']}", json={"enabled": False})
        ).status_code == 400
        assert (await web.get("/api/me")).status_code == 200


@pytest.mark.parametrize("field", ["username", "display_name", "name", "description"])
@pytest.mark.parametrize("delta", [-1, 0, 1])
async def test_unicode_field_limits_apply_to_creation_and_mutable_updates(gw, field, delta):
    maximum = 1000 if field == "description" else 128
    text = "😀" * (maximum + delta)  # Python code points, including non-BMP characters.
    store = gw.state.identity
    async with signed_in(gw.mcp.http_app()) as web:
        if field in {"username", "display_name"}:
            endpoint = "/api/users"
            body = {
                "username": "new-person",
                "display_name": "person",
                "password": "new-person-password",
                field: text,
            }
            before = store.list_users()
        else:
            endpoint = "/api/tokens"
            body = {
                "name": "new-token",
                "description": "note",
                "workspace_id": gw.workspace["id"],
                field: text,
            }
            before = store.list_tokens()
        response = await web.post(endpoint, json=body)
        if delta > 0:
            assert response.status_code == 400
            assert (
                store.list_users() if endpoint == "/api/users" else store.list_tokens()
            ) == before
            assert store.pending_events() == []
        else:
            assert response.status_code == 201, response.text
            item = response.json() if endpoint == "/api/users" else response.json()["item"]
            assert item[field] == text
            if field == "username":
                assert store.login(text, "new-person-password")[0]["username"] == text
                return
        if field == "username":
            return
        # Each update independently exercises the same upper limit and rollback.
        if endpoint == "/api/users":
            item = store.create_user("update-person", "update-password")
        else:
            _value, item = store.create_token(
                "update-token", "fixture", workspace_id=gw.workspace["id"]
            )
        before_item = dict(item)
        updated = await web.patch(f"{endpoint}/{item['id']}", json={field: text})
        if delta > 0:
            assert updated.status_code == 400
            actual = (
                next(u for u in store.list_users() if u["id"] == item["id"])
                if endpoint == "/api/users"
                else store.token_info(item["id"])
            )
            assert actual == before_item and store.pending_events() == []
        else:
            assert updated.status_code == 200 and updated.json()[field] == text


@pytest.mark.parametrize("field", ["username", "display_name", "name", "description"])
@pytest.mark.parametrize("value", [None, False, 1, [], {}])
async def test_field_type_errors_leave_identity_and_credentials_unchanged(gw, field, value):
    store = gw.state.identity
    async with signed_in(gw.mcp.http_app()) as web:
        before_users, before_tokens = store.list_users(), store.list_tokens()
        endpoint = "/api/users" if field in {"username", "display_name"} else "/api/tokens"
        body = (
            {"username": "type-person", "display_name": "person", "password": "type-password"}
            if endpoint == "/api/users"
            else {
                "name": "type-token",
                "description": "note",
                "workspace_id": gw.workspace["id"],
            }
        )
        response = await web.post(endpoint, json={**body, field: value})
        assert response.status_code == 400
        assert store.list_users() == before_users and store.list_tokens() == before_tokens
        if field != "username":
            item = before_users[0] if endpoint == "/api/users" else before_tokens[0]
            assert (
                await web.patch(f"{endpoint}/{item['id']}", json={field: value})
            ).status_code == 400
            assert store.list_users() == before_users and store.list_tokens() == before_tokens
        assert store.pending_events() == []


async def test_empty_names_trimmed_uniqueness_and_strict_boolean_fields(gw):
    async with signed_in(gw.mcp.http_app()) as web:
        for blank in ("", "   "):
            assert (
                await web.post("/api/users", json={"username": blank, "password": "valid-password"})
            ).status_code == 400
            assert (
                await web.post(
                    "/api/tokens", json={"name": blank, "workspace_id": gw.workspace["id"]}
                )
            ).status_code == 400
        person = await web.post(
            "/api/users",
            json={"username": "  trimmed  ", "display_name": "", "password": "valid-password"},
        )
        assert person.status_code == 201
        assert person.json()["username"] == person.json()["display_name"] == "trimmed"
        duplicate = await web.post(
            "/api/users", json={"username": "trimmed", "password": "valid-password"}
        )
        assert duplicate.status_code == 400
        assert (
            await web.patch(f"/api/users/{person.json()['id']}", json={"display_name": ""})
        ).json()["display_name"] == ""
        token = await web.post(
            "/api/tokens",
            json={"name": "  trim-token  ", "description": "", "workspace_id": gw.workspace["id"]},
        )
        assert token.status_code == 201 and token.json()["item"]["name"] == "trim-token"
        assert token.json()["item"]["description"] == ""
        for endpoint, item in (("users", person.json()), ("tokens", token.json()["item"])):
            path = f"/api/{endpoint}/{item['id']}"
            assert (await web.patch(path, json={"enabled": "false"})).status_code == 400
            for enabled in (False, True):
                response = await web.patch(path, json={"enabled": enabled})
                assert response.status_code == 200 and response.json()["enabled"] is enabled
