"""SQLite 读取离开事件循环后，仍使用最新的资源归属与目标快照。"""

import asyncio
import threading

import pytest
from fastmcp import Client
from httpx2 import ASGITransport, AsyncClient

from ssh_mcp.authorization import REQUEST_TARGETS, authorize_server
from ssh_mcp.errors import AuthorizationError


async def test_identity_reads_in_async_call_paths_run_in_workers(gw, monkeypatch):
    event_loop_thread = threading.get_ident()
    observed = set()

    def checked(name, operation):
        def read(*args, **kwargs):
            assert threading.get_ident() != event_loop_thread, name
            observed.add(name)
            return operation(*args, **kwargs)
        return read

    for name in ("active_token_info", "token_info", "workspace_info", "list_workspaces"):
        monkeypatch.setattr(gw.state.identity, name, checked(name, getattr(gw.state.identity, name)))

    async with Client(gw.mcp) as client:
        await client.call_tool("list_servers", {})
        await client.call_tool("exec_command", {"server": "web-1", "command": "whoami"})
        await client.call_tool("server_health", {})

    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://localhost",
    ) as web:
        setup = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        web.headers["X-CSRF-Token"] = setup.json()["csrf_token"]
        changed = await web.put("/api/servers/web-1", json={
            "host": "10.0.0.11", "username": "deploy", "workspace_ids": [gw.workspace["id"]],
        })
        assert changed.status_code == 200, changed.text

    bob = gw.state.identity.verify_token(gw.tokens["bob"])
    await asyncio.to_thread(gw.state.identity.update_token, bob["id"], {"enabled": False})
    assert await gw.mcp.auth.verify_token(gw.tokens["bob"]) is None
    assert observed == {"active_token_info", "token_info", "workspace_info", "list_workspaces"}


@pytest.mark.parametrize("change_target", [False, True])
async def test_resource_changes_while_identity_lookup_waits_are_rechecked(
    gw, monkeypatch, change_target,
):
    entered, release = threading.Event(), threading.Event()
    original = gw.state.identity.active_token_info
    original_entry = gw.state.config.get_server("web-1")
    snapshots = REQUEST_TARGETS.set({
        "web-1": original_entry.model_dump(exclude={"workspace_ids"}),
    })

    def delayed(token_id):
        info = original(token_id)
        entered.set()
        assert release.wait(timeout=5)
        return info

    monkeypatch.setattr(gw.state.identity, "active_token_info", delayed)
    task = asyncio.create_task(authorize_server(gw.state, "web-1"))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        raw = next(row for row in gw.cfg_file.raw["servers"] if row["alias"] == "web-1")
        changes = {"host": "changed-target.invalid"} if change_target else {"workspace_ids": []}
        await gw.state.upsert_server({**raw, **changes})
        release.set()
        with pytest.raises(AuthorizationError):
            await task
    finally:
        release.set()
        REQUEST_TARGETS.reset(snapshots)
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("method", ["put", "post"])
async def test_concurrent_resource_mutations_audit_the_serialized_previous_membership(
    gw, monkeypatch, method,
):
    b = gw.state.identity.create_workspace("项目 B")
    c = gw.state.identity.create_workspace("项目 C")
    write_entered, release_write = threading.Event(), threading.Event()
    second_arrived = asyncio.Event()
    original_write = gw.cfg_file.upsert_server
    original_upsert = gw.state.upsert_server

    def paused_write(entry):
        if entry["workspace_ids"] == [b["id"]]:
            write_entered.set()
            assert release_write.wait(timeout=5)
        return original_write(entry)

    async def observed_upsert(entry, event=None):
        if entry["workspace_ids"] == [c["id"]]:
            second_arrived.set()
        return await original_upsert(entry, event)

    monkeypatch.setattr(gw.cfg_file, "upsert_server", paused_write)
    monkeypatch.setattr(gw.state, "upsert_server", observed_upsert)
    async with AsyncClient(
        transport=ASGITransport(app=gw.mcp.http_app()), base_url="http://localhost",
    ) as web:
        setup = await web.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        web.headers["X-CSRF-Token"] = setup.json()["csrf_token"]
        path = "/api/servers/web-1" if method == "put" else "/api/servers"
        body = {"alias": "web-1", "host": "10.0.0.11", "username": "deploy"}
        first = asyncio.create_task(web.request(method, path, json={**body, "workspace_ids": [b["id"]]}))
        second = None
        try:
            assert await asyncio.to_thread(write_entered.wait, 2)
            second = asyncio.create_task(web.request(method, path, json={**body, "workspace_ids": [c["id"]]}))
            await asyncio.wait_for(second_arrived.wait(), timeout=2)
            release_write.set()
            responses = await asyncio.gather(first, second)
            assert all(response.status_code < 300 for response in responses)
        finally:
            release_write.set()
            await asyncio.gather(first, *([second] if second else []), return_exceptions=True)

    action = "server.update" if method == "put" else "server.create"
    records, _ = gw.state.audit.query(kind="person", q=action)
    summaries = [row["summary"] for row in records if row["status"] == "ok"]
    original_name = f"{gw.workspace['name']} ({gw.workspace['id']})"
    b_name, c_name = (f"{space['name']} ({space['id']})" for space in (b, c))
    assert len(summaries) == 2
    assert any(f"{original_name} → {b_name}" in summary for summary in summaries)
    assert any(f"{b_name} → {c_name}" in summary for summary in summaries)
    assert all(f"{original_name} → {c_name}" not in summary for summary in summaries)
