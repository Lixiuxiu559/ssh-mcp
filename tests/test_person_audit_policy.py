"""显式路由审计策略、事务接线以及 HTTP 失败/取消下的真实结果。"""

import asyncio
import threading

import pytest
from httpx2 import ASGITransport, AsyncClient
from starlette.requests import Request

from ssh_mcp.web import api as web_api
from ssh_mcp.web.person_audit import (
    PersonAuditContractError,
    PersonAuditMode,
    call_outbox,
    call_outbox_async,
    validate_audit_mode,
)

OUTBOX_ROUTES = {
    ("POST", "/api/auth/setup"): "user.initialize",
    ("POST", "/api/auth/login"): "user.login",
    ("POST", "/api/auth/logout"): "user.logout",
    ("POST", "/api/users"): "user.create",
    ("PATCH", "/api/users/{id}"): "user.update",
    ("DELETE", "/api/users/{id}"): "user.delete",
    ("POST", "/api/workspaces"): "workspace.create",
    ("PATCH", "/api/workspaces/{id}"): "workspace.update",
    ("DELETE", "/api/workspaces/{id}"): "workspace.delete",
    ("POST", "/api/tokens"): "token.create",
    ("POST", "/api/tokens/{id}/reveal"): "token.copy",
    ("PATCH", "/api/tokens/{id}"): "token.update",
    ("DELETE", "/api/tokens/{id}"): "token.delete",
}
LIFECYCLE_ROUTES = {
    ("POST", "/api/servers/test"): "server.test",
    ("POST", "/api/servers"): "server.create",
    ("PUT", "/api/servers/{alias}"): "server.update",
    ("DELETE", "/api/servers/{alias}"): "server.delete",
    ("POST", "/api/keys"): "key.upload",
    ("GET", "/api/audit/export"): "audit.export",
}


@pytest.mark.parametrize(
    "action,mode",
    [
        (None, PersonAuditMode.OUTBOX),
        (None, PersonAuditMode.LIFECYCLE),
        ("user.create", None),
        ("user.create", "outbox"),
        ("", PersonAuditMode.OUTBOX),
        (42, PersonAuditMode.OUTBOX),
    ],
)
def test_invalid_route_policy_is_rejected(action, mode):
    with pytest.raises(PersonAuditContractError):
        validate_audit_mode(action, mode)


async def test_every_route_registers_and_runs_with_explicit_policy(gw, monkeypatch):
    routes, declarations = {}, []
    original = web_api.validate_audit_mode

    def checked(action, mode):
        original(action, mode)
        declarations.append((action, mode))

    class Recorder:
        def custom_route(self, path, *, methods):
            def register(handler):
                for method in methods:
                    routes[method, path] = handler
                return handler

            return register

    monkeypatch.setattr(web_api, "validate_audit_mode", checked)
    web_api.register_web_routes(Recorder(), gw.state)
    expected = {
        **{key: PersonAuditMode.OUTBOX for key in OUTBOX_ROUTES},
        **{key: PersonAuditMode.LIFECYCLE for key in LIFECYCLE_ROUTES},
    }
    assert set(expected) <= routes.keys()
    assert {(action, mode) for action, mode in declarations if action} == {
        (action, expected[key]) for key, action in (OUTBOX_ROUTES | LIFECYCLE_ROUTES).items()
    }
    assert len(declarations) == len(routes)
    for (method, path), handler in routes.items():
        # 无 Cookie；公开 POST 缺 Content-Type。观察模式而不触发业务变更。
        request = Request(
            {
                "type": "http",
                "method": method,
                "path": path,
                "headers": [],
                "query_string": b"",
                "path_params": {"path": "missing-file"},
                "client": ("127.0.0.1", 1000),
                "server": ("test", 80),
            }
        )
        await handler(request)
        assert request.state.person_audit_mode is expected.get((method, path))


def audit_request(mode=PersonAuditMode.OUTBOX, record=True):
    request = Request({"type": "http", "headers": []})
    request.state.person_audit_mode = mode
    request.state.identity_event = {"event_id": "test-event"} if record else None
    request.state.outbox_recorded = False
    return request


@pytest.mark.parametrize("helper", [call_outbox, call_outbox_async])
@pytest.mark.parametrize(
    "mode,record,kwargs",
    [
        (None, True, {}),
        (PersonAuditMode.LIFECYCLE, True, {}),
        (PersonAuditMode.OUTBOX, False, {}),
        (PersonAuditMode.OUTBOX, True, {"event": {"secret": "never-log-this"}}),
    ],
)
async def test_bad_helper_context_never_starts_operation(helper, mode, record, kwargs):
    calls = []

    def operation(*args, **options):
        calls.append(options)
        raise AssertionError("业务操作不能开始")

    with pytest.raises(PersonAuditContractError) as error:
        await helper(audit_request(mode, record), operation, **kwargs)
    assert not calls
    assert "never-log-this" not in str(error.value)


@pytest.mark.parametrize("async_operation", [False, True])
async def test_helper_preserves_result_event_thread_and_error_without_retry(async_operation):
    request = audit_request()
    caller = threading.get_ident()
    observed = []
    result = object()

    def operation(value, *, event):
        observed.append(threading.get_ident())
        assert value == "input" and event is request.state.identity_event
        assert not request.state.outbox_recorded
        return result

    async def async_call(value, *, event):
        return operation(value, event=event)

    helper = call_outbox_async if async_operation else call_outbox
    callback = async_call if async_operation else operation
    assert await helper(request, callback, "input") is result
    assert request.state.outbox_recorded
    assert (observed[0] == caller) is async_operation

    request.state.outbox_recorded = False
    failure = RuntimeError("operation failed")
    attempts = []

    def fail(*, event):
        attempts.append(event)
        raise failure

    async def async_fail(*, event):
        return fail(event=event)

    with pytest.raises(RuntimeError) as error:
        await helper(request, async_fail if async_operation else fail)
    assert error.value is failure and len(attempts) == 1
    assert not request.state.outbox_recorded


@pytest.fixture
async def console(gw):
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin"}
        )
        assert response.status_code == 200
        client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        yield client


async def test_missing_outbox_registration_cannot_return_success_or_secret(
    console, gw, monkeypatch, caplog
):
    async def unregistered(*args, **kwargs):
        return {"id": "uncommitted", "username": "must-not-return"}

    monkeypatch.setattr(web_api, "call_outbox", unregistered)
    response = await console.post(
        "/api/users", json={"username": "missing", "password": "secret-password"}
    )
    assert response.status_code == 500
    assert response.json() == {"detail": "服务暂时无法完成操作，请稍后重试"}
    assert "must-not-return" not in response.text
    assert "secret-password" not in caplog.text
    assert all(user["username"] != "missing" for user in gw.state.identity.list_users())
    rows, total = gw.state.audit.query(kind="person", q="user.create")
    assert total == 1 and rows[0]["status"] == "error"


async def test_response_failure_after_commit_keeps_single_success_outbox(console, gw, monkeypatch):
    original = web_api.JSONResponse

    def response(content, *args, **kwargs):
        if isinstance(content, dict) and content.get("username") == "response-failure":
            raise RuntimeError("response encoding failed")
        return original(content, *args, **kwargs)

    monkeypatch.setattr(web_api, "JSONResponse", response)
    result = await console.post(
        "/api/users", json={"username": "response-failure", "password": "abc123"}
    )
    assert result.status_code == 500
    user = next(
        user for user in gw.state.identity.list_users() if user["username"] == "response-failure"
    )
    rows, total = gw.state.audit.query(kind="person", q="user.create")
    assert total == 1 and rows[0]["status"] == "ok" and rows[0]["object_id"] == user["id"]
    assert gw.state.identity.pending_events() == []


async def test_cancelled_http_request_preserves_late_transaction_without_false_event(
    console, gw, monkeypatch
):
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    original = gw.state.identity.create_user

    def delayed(*args, **kwargs):
        entered.set()
        try:
            assert release.wait(timeout=5)
            return original(*args, **kwargs)
        finally:
            finished.set()

    monkeypatch.setattr(gw.state.identity, "create_user", delayed)
    task = asyncio.create_task(
        console.post("/api/users", json={"username": "late-user", "password": "abc123"})
    )
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 5)
        if not task.done():
            await task
    assert any(user["username"] == "late-user" for user in gw.state.identity.list_users())
    assert gw.state.audit.query(kind="person", q="user.create")[1] == 0
    pending = gw.state.identity.pending_events()
    assert len(pending) == 1 and pending[0][1]["status"] == "ok"
    await gw.state.flush_identity_events()
    rows, total = gw.state.audit.query(kind="person", q="user.create")
    assert total == 1 and rows[0]["status"] == "ok"
    assert rows[0]["event_id"] == pending[0][1]["event_id"]


async def test_lifecycle_http_200_business_failure_keeps_error_audit(console, gw, monkeypatch):
    async def failed_connection(*args, **kwargs):
        raise OSError("credential-must-not-leak")

    monkeypatch.setattr(gw.state.pool, "connect_one_shot", failed_connection)
    response = await console.post(
        "/api/servers/test",
        json={
            "alias": "probe",
            "host": "example.invalid",
            "username": "ops",
            "credential": {"type": "password", "password": "abc123"},
        },
    )
    assert response.status_code == 200 and response.json()["ok"] is False
    rows, total = gw.state.audit.query(kind="person", q="server.test")
    assert total == 1 and rows[0]["status"] == "error"
    assert "credential-must-not-leak" not in str(rows)


async def test_async_helper_requires_callable_and_propagates_cancellation():
    request = audit_request()
    entered = asyncio.Event()

    async def operation(*, event):
        entered.set()
        await asyncio.Event().wait()

    coroutine = operation(event=request.state.identity_event)
    try:
        with pytest.raises(PersonAuditContractError):
            await call_outbox_async(request, coroutine)
        assert not entered.is_set()
    finally:
        coroutine.close()
    task = asyncio.create_task(call_outbox_async(request, operation))
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not request.state.outbox_recorded
