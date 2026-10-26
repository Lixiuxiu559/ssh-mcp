"""配置模块测试：插值、校验、读写往返。"""

from __future__ import annotations

import os
import stat as st

import pytest

from ssh_mcp.config import ConfigError, expand_env_vars


def test_expand_env_resolves(monkeypatch):
    monkeypatch.setenv("FOO", "bar")
    assert expand_env_vars("${FOO}/x") == "bar/x"
    assert expand_env_vars({"a": ["${FOO}", 1]}) == {"a": ["bar", 1]}


def test_expand_env_missing_fails_fast(monkeypatch):
    monkeypatch.delenv("NOPE", raising=False)
    with pytest.raises(ConfigError, match="NOPE"):
        expand_env_vars("${NOPE}")


def test_expand_env_dollar_escape(monkeypatch):
    monkeypatch.setenv("FOO", "bar")
    assert expand_env_vars("$$${FOO}") == "$bar"


def test_load_interpolates_credentials(make_mcp):
    gw = make_mcp()
    db = gw.state.config.get_server("db-1")
    assert db.credential.password.get_secret_value() == "db-pw"


def test_duplicate_alias_rejected(make_mcp):
    with pytest.raises(ConfigError, match="重复的 alias"):
        make_mcp(
            extra_config="\n  - alias: web-1\n    host: 1.2.3.4\n    username: x\n"
            "    credential:\n      type: password\n      password: p\n"
        )


def test_invalid_alias_rejected(make_mcp):
    with pytest.raises(ConfigError, match="alias"):
        make_mcp(
            extra_config="\n  - alias: 'bad alias!'\n    host: 1.2.3.4\n    username: x\n"
            "    credential:\n      type: password\n      password: p\n"
        )


async def test_upsert_new_server_and_persists(make_mcp):
    gw = make_mcp()
    entry = {
        "alias": "cache-1",
        "host": "10.0.0.30",
        "username": "redis",
        "credential": {"type": "password", "password": "redis-pw"},
    }
    config = await gw.state.upsert_server(entry)
    assert config.get_server("cache-1") is not None
    assert gw.state.config.get_server("cache-1").host == "10.0.0.30"
    # 已落盘
    assert "cache-1" in gw.config_path.read_text()


async def test_upsert_keeps_credential_when_omitted(make_mcp):
    gw = make_mcp()
    await gw.state.upsert_server({"alias": "db-1", "host": "10.0.0.99", "username": "ops"})
    assert gw.state.config.get_server("db-1").host == "10.0.0.99"
    # 原凭据（含 ${ENV} 引用）被保留
    assert gw.cfg_file.raw["servers"][1]["credential"]["password"] == "${TEST_DB1_PASSWORD}"


async def test_upsert_rejects_invalid_and_rolls_back(make_mcp):
    gw = make_mcp()
    with pytest.raises(ConfigError):
        await gw.state.upsert_server(
            {
                "alias": "bad alias!",
                "host": "h",
                "username": "u",
                "credential": {"type": "unknown"},
            }
        )
    assert all(s["alias"] != "bad alias!" for s in gw.cfg_file.raw["servers"])


async def test_delete_server(make_mcp):
    gw = make_mcp()
    await gw.state.delete_server("db-1")
    assert gw.state.config.get_server("db-1") is None
    assert gw.cfg_file.raw["servers"][0]["alias"] == "web-1"


async def test_save_preserves_env_refs_and_chmod(make_mcp):
    gw = make_mcp()
    await gw.state.upsert_server({"alias": "db-1", "host": "10.0.0.21", "username": "ops"})
    mode = st.S_IMODE(os.stat(gw.config_path).st_mode)
    assert mode & 0o077 == 0  # 组/其他无权限
    text = gw.config_path.read_text()
    assert "${TEST_DB1_PASSWORD}" in text
    assert "10.0.0.21" in text


async def test_agent_credential_type_removed(make_mcp):
    """已移除的 agent 凭据类型：拒绝并给出可读提示，而不是 pydantic 原文。"""
    gw = make_mcp()
    with pytest.raises(ConfigError) as exc:
        await gw.state.upsert_server(
            {"alias": "old-style", "host": "h", "username": "u", "credential": {"type": "agent"}}
        )
    msg = str(exc.value)
    assert "agent 凭据类型已移除" in msg
    assert "private_key_file" in msg
