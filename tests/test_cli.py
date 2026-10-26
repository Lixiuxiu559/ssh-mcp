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
