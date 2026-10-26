"""Web 管理端 API 测试：鉴权、CRUD、热更新、测试连接。"""

from __future__ import annotations

import asyncssh
import pytest
from fastmcp import Client
from httpx2 import ASGITransport, AsyncClient


@pytest.fixture
def app(gw):
    return gw.mcp.http_app()


async def request(app, method: str, path: str, token: str | None = None, **kwargs):
    headers = kwargs.pop("headers", {})
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        return await client.request(method, path, headers=headers, **kwargs)


async def test_index_serves_html(app):
    resp = await request(app, "GET", "/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "ssh-mcp" in resp.text


async def test_healthz_no_auth(app):
    resp = await request(app, "GET", "/healthz")
    assert resp.status_code == 200


async def test_me_auth(app):
    assert (await request(app, "GET", "/api/me")).status_code == 401
    assert (await request(app, "GET", "/api/me", token="wrong")).status_code == 401
    resp = await request(app, "GET", "/api/me", token="tok-alice")
    assert resp.status_code == 200
    assert resp.json() == {"username": "alice", "admin": True, "default_admin": False}
    resp = await request(app, "GET", "/api/me", token="tok-bob")
    assert resp.json() == {"username": "bob", "admin": False, "default_admin": False}


async def test_list_servers_no_secrets(app):
    resp = await request(app, "GET", "/api/servers", token="tok-bob")
    assert resp.status_code == 200
    servers = resp.json()["servers"]
    assert {s["alias"] for s in servers} == {"web-1", "db-1"}
    text = resp.text
    assert "db-pw" not in text and "/keys/web-1.pem" not in text
    assert servers[0]["credential_type"] in {"private_key_file", "password"}


_NEW_SERVER = {
    "alias": "cache-1",
    "host": "10.0.0.30",
    "username": "redis",
    "credential": {"type": "password", "password": "redis-pw"},
}


async def test_create_requires_admin(app):
    resp = await request(app, "POST", "/api/servers", token="tok-bob", json=_NEW_SERVER)
    assert resp.status_code == 403


async def test_create_list_update_delete(app):
    resp = await request(app, "POST", "/api/servers", token="tok-alice", json=_NEW_SERVER)
    assert resp.status_code == 201
    assert resp.json()["alias"] == "cache-1"

    resp = await request(app, "GET", "/api/servers", token="tok-bob")
    assert {s["alias"] for s in resp.json()["servers"]} == {"web-1", "db-1", "cache-1"}

    # 更新：不传凭据则保留原值
    resp = await request(
        app, "PUT", "/api/servers/cache-1", token="tok-alice",
        json={"alias": "cache-1", "host": "10.0.0.31", "username": "redis"},
    )
    assert resp.status_code == 200
    assert resp.json()["host"] == "10.0.0.31"

    resp = await request(app, "PUT", "/api/servers/missing", token="tok-alice", json={})
    assert resp.status_code == 404

    resp = await request(app, "DELETE", "/api/servers/cache-1", token="tok-alice")
    assert resp.status_code == 200
    resp = await request(app, "DELETE", "/api/servers/cache-1", token="tok-alice")
    assert resp.status_code == 404


async def test_create_invalid_returns_400(app):
    bad = {**_NEW_SERVER, "alias": "bad alias!"}
    resp = await request(app, "POST", "/api/servers", token="tok-alice", json=bad)
    assert resp.status_code == 400


async def test_config_hot_reload_visible_to_tools(app, gw):
    async with Client(gw.mcp) as client:
        before = await client.call_tool("list_servers", {})
        assert len(before.data.servers) == 2

        resp = await request(app, "POST", "/api/servers", token="tok-alice", json=_NEW_SERVER)
        assert resp.status_code == 201

        after = await client.call_tool("list_servers", {})
        assert [s.alias for s in after.data.servers] == ["web-1", "db-1", "cache-1"]


async def test_test_connection(app, gw):
    resp = await request(app, "POST", "/api/servers/test", token="tok-bob", json=_NEW_SERVER)
    assert resp.status_code == 403

    resp = await request(app, "POST", "/api/servers/test", token="tok-alice", json=_NEW_SERVER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    # 测试连接走的是一次性新连接，不进连接池
    assert gw.state.pool._conns == {}

    resp = await request(
        app, "POST", "/api/servers/test", token="tok-alice",
        json={"alias": "x", "host": "h", "username": "u"},
    )
    assert resp.status_code == 400  # 缺凭据


async def test_test_connection_failure_reported(app, gw, harness):
    harness.fail_next_connect = OSError("refused")
    resp = await request(app, "POST", "/api/servers/test", token="tok-alice", json=_NEW_SERVER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert "refused" in body["error"]


async def test_upload_key_requires_admin(app):
    resp = await request(
        app, "POST", "/api/keys", token="tok-bob",
        json={"alias": "web-1", "content": "-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----"},
    )
    assert resp.status_code == 403


async def test_upload_key_validates(app):
    # 非法别名（防目录穿越 / 文件名污染）
    for bad_alias in ["../evil", "a/b", "", "has space"]:
        resp = await request(
            app, "POST", "/api/keys", token="tok-alice",
            json={"alias": bad_alias, "content": "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----"},
        )
        assert resp.status_code == 400, bad_alias

    # 不是私钥内容
    resp = await request(
        app, "POST", "/api/keys", token="tok-alice",
        json={"alias": "web-1", "content": "hello world"},
    )
    assert resp.status_code == 400


async def test_upload_key_stores_file(app, gw, tmp_path):
    key = asyncssh.generate_private_key("ssh-ed25519").export_private_key().decode()
    resp = await request(
        app, "POST", "/api/keys", token="tok-alice",
        json={"alias": "web-1", "content": key},
    )
    assert resp.status_code == 200
    path = resp.json()["path"]
    # 落在配置文件同级的 keys/ 目录，权限 0600
    assert path == str(tmp_path / "keys" / "web-1.pem")
    stored = tmp_path / "keys" / "web-1.pem"
    assert stored.read_text(encoding="utf-8") == key
    assert (stored.stat().st_mode & 0o777) == 0o600

    # 落盘后的路径可直接用于测试连接（假连接层会返回成功）
    resp = await request(
        app, "POST", "/api/servers/test", token="tok-alice",
        json={"alias": "web-1", "host": "10.0.0.11", "username": "deploy",
              "credential": {"type": "private_key_file", "path": path}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


async def test_audit_endpoint(app, gw):
    resp = await request(app, "GET", "/api/audit", token="tok-bob")
    assert resp.status_code == 200
    assert resp.json()["records"] == []


async def test_default_admin_bootstrap(tmp_path, harness):
    """未配置任何成员时内置 admin/admin；配置正式成员后默认账号自动失效。"""
    from ssh_mcp.config import ConfigFile
    from ssh_mcp.server import create_mcp

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "server:\n  host: 127.0.0.1\n  port: 8808\nservers: []\n", encoding="utf-8"
    )
    mcp, _ = create_mcp(ConfigFile(config_path))
    app = mcp.http_app()

    # 默认账号可登录且标记为 default_admin
    resp = await request(app, "GET", "/api/me", token="admin")
    assert resp.status_code == 200
    assert resp.json() == {"username": "admin", "admin": True, "default_admin": True}

    # 未配置 auth 时，成员列表展示当前生效的内置账号，便于直接改名/换 token
    resp = await request(app, "GET", "/api/users", token="admin")
    assert resp.json()["users"] == [{"username": "admin", "admin": True, "token": "admin"}]

    # 设置正式成员后，默认账号失效，新账号生效
    resp = await request(
        app, "PUT", "/api/users", token="admin",
        json={"users": [{"username": "ops", "token": "ops-tok", "admin": True}]},
    )
    assert resp.status_code == 200
    assert (await request(app, "GET", "/api/me", token="admin")).status_code == 401
    resp = await request(app, "GET", "/api/me", token="ops-tok")
    assert resp.json() == {"username": "ops", "admin": True, "default_admin": False}


async def test_users_requires_admin(app):
    resp = await request(app, "GET", "/api/users", token="tok-bob")
    assert resp.status_code == 403
    resp = await request(app, "PUT", "/api/users", token="tok-bob", json={"users": []})
    assert resp.status_code == 403


async def test_users_list_returns_token(app):
    resp = await request(app, "GET", "/api/users", token="tok-alice")
    assert resp.status_code == 200
    users = resp.json()["users"]
    assert {u["username"] for u in users} == {"alice", "bob"}
    by_name = {u["username"]: u for u in users}
    # 返回 token 配置原文（${ENV} 引用本身），不展开真实值
    assert by_name["alice"]["token"] == "${TEST_ALICE_TOKEN}"
    assert by_name["alice"]["admin"] is True
    assert by_name["bob"]["token"] == "${TEST_BOB_TOKEN}"
    assert by_name["bob"]["admin"] is False
    assert "tok-alice" not in resp.text


async def test_users_update_keeps_and_changes_token(app, gw):
    # bob 换新 token（明文）；alice 提交原引用 = 不变
    payload = {
        "users": [
            {"username": "alice", "token": "${TEST_ALICE_TOKEN}", "admin": True},
            {"username": "bob", "token": "bob-new-secret", "admin": False},
        ]
    }
    resp = await request(app, "PUT", "/api/users", token="tok-alice", json=payload)
    assert resp.status_code == 200

    # alice 旧 token 仍有效（保留），bob 旧 token 失效、新 token 生效
    assert (await request(app, "GET", "/api/me", token="tok-alice")).status_code == 200
    assert (await request(app, "GET", "/api/me", token="tok-bob")).status_code == 401
    assert (await request(app, "GET", "/api/me", token="bob-new-secret")).status_code == 200

    # 配置文件里 bob 的新 token 落盘，alice 保留 ${ENV} 引用
    raw = gw.config_path.read_text(encoding="utf-8")
    assert "bob-new-secret" in raw
    assert "${TEST_ALICE_TOKEN}" in raw


async def test_users_update_validates(app):
    # token 为空（含已有用户）
    resp = await request(
        app, "PUT", "/api/users", token="tok-alice",
        json={"users": [{"username": "alice", "token": "", "admin": True}]},
    )
    assert resp.status_code == 400
    assert "token 不能为空" in resp.json()["detail"]

    # 用户名重复（中文可读报错）
    resp = await request(
        app, "PUT", "/api/users", token="tok-alice",
        json={"users": [
            {"username": "a", "token": "t1"},
            {"username": "a", "token": "t2"},
        ]},
    )
    assert resp.status_code == 400
    assert "用户名重复: a" in resp.json()["detail"]

    # 空列表
    resp = await request(app, "PUT", "/api/users", token="tok-alice", json={"users": []})
    assert resp.status_code == 400
    assert "至少" in resp.json()["detail"]

    # 校验失败不落盘：原有用户仍可用
    assert (await request(app, "GET", "/api/me", token="tok-alice")).status_code == 200
    assert (await request(app, "GET", "/api/me", token="tok-bob")).status_code == 200
