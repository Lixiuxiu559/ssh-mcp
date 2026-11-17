"""CLI 初始化在源码、安装包及 uvx 中共用，不能覆盖已有运行配置。"""

import stat
import sys

import pytest
import yaml

from ssh_mcp.cli import main


def test_init_creates_private_config_without_runtime_state(tmp_path, monkeypatch):
    config = tmp_path / "runtime" / "config.yaml"
    monkeypatch.setattr(sys, "argv", ["ssh-mcp", "--init", "--config", str(config)])
    main()
    value = yaml.safe_load(config.read_text())
    assert value["servers"] == []
    assert value["server"]["host"] == "127.0.0.1"
    assert "users" not in value["auth"]
    assert stat.S_IMODE(config.stat().st_mode) == 0o600
    assert not (config.parent / "data").exists()


def test_init_never_overwrites_existing_config(tmp_path, monkeypatch):
    config = tmp_path / "config.yaml"
    config.write_text("servers: []\n# keep me\n")
    monkeypatch.setattr(sys, "argv", ["ssh-mcp", "--init", "--config", str(config)])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    assert config.read_text() == "servers: []\n# keep me\n"


def test_cli_rejects_invalid_port_before_creating_identity(tmp_path, monkeypatch, capsys):
    config = tmp_path / "config.yaml"
    config.write_text("servers: []\n")
    monkeypatch.setattr(sys, "argv", ["ssh-mcp", "--config", str(config), "--port", "0"])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    assert "端口" in capsys.readouterr().err
    assert not (tmp_path / "data").exists()


def test_init_reports_unwritable_parent_without_traceback(tmp_path, monkeypatch, capsys):
    parent = tmp_path / "not-a-directory"
    parent.write_text("existing file")
    monkeypatch.setattr(sys, "argv", ["ssh-mcp", "--init", "--config", str(parent / "config.yaml")])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    assert "目录权限" in capsys.readouterr().err
    assert parent.read_text() == "existing file"


@pytest.fixture
def container_cli(monkeypatch):
    from types import SimpleNamespace

    from ssh_mcp import cli, server

    states, calls = [], []
    original = server.create_mcp

    def create(config):
        mcp, state = original(config)
        states.append(state)
        monkeypatch.setattr(mcp, "run", lambda **kwargs: calls.append(kwargs))
        return mcp, state

    monkeypatch.setattr(cli, "create_mcp", create)

    def start(config, *extra):
        monkeypatch.setattr(sys, "argv", ["ssh-mcp", "--config", str(config), *extra])
        cli.main()
        return states[-1]

    yield SimpleNamespace(start=start, calls=calls)
    for state in states:
        state.identity.close()
        state.audit.close()


def test_container_first_start_creates_config_and_default_account(tmp_path, container_cli):
    config = tmp_path / "volume" / "config.yaml"
    state = container_cli.start(config, "--init-if-missing", "--host", "0.0.0.0")
    assert stat.S_IMODE(config.stat().st_mode) == 0o600
    assert state.identity.login("admin", "admin")
    assert len(state.identity.list_users()) == 1
    assert container_cli.calls == [{"transport": "http", "host": "0.0.0.0", "port": 8808}]


def test_container_restart_keeps_config_credentials_and_token(tmp_path, container_cli):
    config = tmp_path / "volume" / "config.yaml"
    first = container_cli.start(config, "--init-if-missing")
    user = first.identity.list_users()[0]
    first.identity.update_user(user["id"], {"password": "saved-password"})
    workspace = first.identity.create_workspace("saved-project")
    value, token = first.identity.create_token("saved-client", user["id"], workspace_id=workspace["id"])
    content = config.read_bytes() + b"\n# preserve operator configuration\n"
    config.write_bytes(content)
    first.identity.close()
    first.audit.close()

    second = container_cli.start(config, "--init-if-missing")
    assert config.read_bytes() == content
    assert second.identity.login("admin", "saved-password")
    assert [u["id"] for u in second.identity.list_users()] == [user["id"]]
    assert second.identity.verify_token(value)["id"] == token["id"]
    assert second.identity.workspace_info(workspace["id"])["name"] == "saved-project"


@pytest.mark.parametrize("mode", ["directory", "invalid-yaml", "blocked-parent"])
def test_container_start_never_replaces_invalid_existing_paths(tmp_path, container_cli, capsys, mode):
    config = tmp_path / "config.yaml"
    if mode == "directory":
        config.mkdir()
    elif mode == "invalid-yaml":
        config.write_text("invalid: [\n")
    else:
        parent = tmp_path / "blocked"
        parent.write_text("keep original")
        config = parent / "config.yaml"
    with pytest.raises(SystemExit) as error:
        container_cli.start(config, "--init-if-missing")
    assert error.value.code == 1
    assert not container_cli.calls
    assert "Traceback" not in capsys.readouterr().err
    if mode == "directory":
        assert config.is_dir()
    elif mode == "invalid-yaml":
        assert config.read_text() == "invalid: [\n"
    else:
        assert parent.read_text() == "keep original"


def test_source_start_still_requires_explicit_configuration(tmp_path, container_cli):
    config = tmp_path / "missing.yaml"
    with pytest.raises(SystemExit) as error:
        container_cli.start(config)
    assert error.value.code == 1
    assert not config.exists()
    assert not container_cli.calls
