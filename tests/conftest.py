"""测试公共设施：Fake SSH 层 + 网关 fixture。

FakeConn/FakeSFTP 模拟 asyncssh 接口，monkeypatch 全局 asyncssh.connect，
使连接池与网页"测试连接"都走假连接。
"""

from __future__ import annotations

import inspect
import posixpath
from pathlib import Path
from types import SimpleNamespace

import asyncssh
import pytest

from ssh_mcp.config import ConfigFile
from ssh_mcp.server import create_mcp

_ALICE_TOKEN = "tok-alice"
_BOB_TOKEN = "tok-bob"

_CONFIG = """
server:
  host: 127.0.0.1
  port: 8808
auth:
  users:
    - username: alice
      token: ${TEST_ALICE_TOKEN}
      admin: true
    - username: bob
      token: ${TEST_BOB_TOKEN}
audit:
  path: __AUDIT_PATH__/audit.db
limits:
  max_read_file_bytes: 1024
  max_upload_bytes: 2048
  max_download_bytes: 2048
  max_list_entries: 3
servers:
  - alias: web-1
    host: 10.0.0.11
    username: deploy
    description: Web 一号机
    tags: [web, prod]
    credential:
      type: private_key_file
      path: /keys/web-1.pem
  - alias: db-1
    host: 10.0.0.20
    username: ops
    credential:
      type: password
      password: ${TEST_DB1_PASSWORD}
"""

HEALTH_OUTPUT = """===LOAD===
0.10 0.20 0.30 1/100 999
===MEM===
              total          used          free      shared  buff/cache   available
Mem:     16000000000    8000000000    4000000000    100000000   3000000000   7900000000
Swap:     4000000000             0    4000000000
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/vda1         41152812  12345678  26655678      32%  /
tmpfs               500000       100    499900       1%  /run
===CPU===
8
===UP===
123456.78 987654.32
"""


class FakeProc:
    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", exit_status: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.exit_status = exit_status


class FakeAttrs:
    def __init__(self, permissions: int, size: int, mtime: int = 1700000000):
        self.permissions = permissions
        self.size = size
        self.mtime = mtime


class FakeName:
    def __init__(self, filename: str, attrs: FakeAttrs):
        self.filename = filename
        self.attrs = attrs


class FakeSFTPFile:
    def __init__(self, harness: Harness, path: str, mode: str):
        self._harness = harness
        self._path = path
        self._mode = mode
        if "w" in mode:
            harness.fs_files[path] = b""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def read(self, size: int = -1) -> bytes:
        data = self._harness.fs_files[self._path]
        return data[:size] if size >= 0 else data

    async def write(self, chunk: bytes) -> int:
        self._harness.fs_files[self._path] = self._harness.fs_files.get(self._path, b"") + chunk
        return len(chunk)


class FakeSFTP:
    def __init__(self, harness: Harness):
        self._harness = harness

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def _stat_target(self, path: str):
        if path in self._harness.fs_files:
            return FakeAttrs(0o100644, len(self._harness.fs_files[path]))
        if path in self._harness.fs_dirs:
            return FakeAttrs(0o040755, 0)
        raise asyncssh.SFTPNoSuchFile(f"{path}: no such file")

    async def stat(self, path: str) -> FakeAttrs:
        return self._stat_target(path)

    async def readdir(self, path: str) -> list[FakeName]:
        """对齐真实 asyncssh：readdir 返回带 filename/attrs 的条目（listdir 只返回名字）。"""
        path = path.rstrip("/") or "/"
        parents = {posixpath.dirname(k.rstrip("/")) for k in self._harness.fs_files}
        if path not in self._harness.fs_dirs and path not in parents:
            raise asyncssh.SFTPNoSuchFile(f"{path}: no such directory")
        names, seen = [], set()
        for key in list(self._harness.fs_files) + list(self._harness.fs_dirs):
            parent, base = posixpath.split(key.rstrip("/"))
            if parent == path and base and base not in seen:
                seen.add(base)
                is_dir = key in self._harness.fs_dirs
                size = 0 if is_dir else len(self._harness.fs_files.get(key, b""))
                names.append(FakeName(base, FakeAttrs(0o040755 if is_dir else 0o100644, size)))
        return names

    def open(self, path: str, mode: str = "r") -> FakeSFTPFile:
        """对齐真实 asyncssh：写模式下父目录不存在会抛 SFTPNoSuchFile。"""
        if "w" in mode:
            parent = posixpath.dirname(path.rstrip("/")) or "/"
            if parent != "/" and parent not in self._harness.fs_dirs:
                raise asyncssh.SFTPNoSuchFile(f"{path}: no such file")
        return FakeSFTPFile(self._harness, path, mode)

    async def makedirs(self, path: str, exist_ok: bool = False) -> None:
        if path in self._harness.fs_dirs and not exist_ok:
            raise asyncssh.SFTPError("failure", f"{path} exists")
        self._harness.fs_dirs.add(path)


class FakeConn:
    def __init__(self, harness: Harness, host: str = ""):
        self._harness = harness
        self._host = host

    async def run(self, command: str, check: bool = False, encoding: str | None = None):
        self._harness.exec_calls.append(command)
        result = self._harness.exec_behavior(command, self._host)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, Exception):
            raise result
        return result

    def start_sftp_client(self) -> FakeSFTP:
        return FakeSFTP(self._harness)

    def close(self) -> None:
        pass


class Harness:
    """承载一次测试的全部假状态。"""

    def __init__(self):
        self.fs_files: dict[str, bytes] = {}
        self.fs_dirs: set[str] = {"/"}
        self.exec_calls: list[str] = []
        self.connect_calls: list[dict] = []
        self.fail_next_connect: Exception | None = None
        self.exec_behavior = self._default_behavior

    def _default_behavior(self, command: str, host: str = ""):
        if command.strip() == "echo ok":  # 网页"测试连接"的验证命令
            return FakeProc(stdout=b"ok\n")
        if "===LOAD===" in command:
            return FakeProc(stdout=HEALTH_OUTPUT.encode())
        return FakeProc(stdout=f"ran: {command}\n".encode())

    async def connect(self, **kwargs):
        self.connect_calls.append(kwargs)
        if self.fail_next_connect is not None:
            exc, self.fail_next_connect = self.fail_next_connect, None
            raise exc
        return FakeConn(self, host=str(kwargs.get("host", "")))


@pytest.fixture
def harness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Harness:
    h = Harness()
    monkeypatch.setattr(asyncssh, "connect", h.connect)
    return h


def make_mcp_factory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """写临时配置文件并构建 mcp/state（含环境变量，独立于 harness 可用）。"""
    monkeypatch.setenv("TEST_ALICE_TOKEN", _ALICE_TOKEN)
    monkeypatch.setenv("TEST_BOB_TOKEN", _BOB_TOKEN)
    monkeypatch.setenv("TEST_DB1_PASSWORD", "db-pw")

    def _make(extra_config: str = "") -> SimpleNamespace:
        config_text = _CONFIG.replace("__AUDIT_PATH__", str(tmp_path / "audit")) + extra_config
        config_path = tmp_path / "config.yaml"
        config_path.write_text(config_text, encoding="utf-8")
        cfg_file = ConfigFile(config_path)
        mcp, state = create_mcp(cfg_file)
        return SimpleNamespace(mcp=mcp, state=state, cfg_file=cfg_file, config_path=config_path)

    return _make


@pytest.fixture
def make_mcp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    return make_mcp_factory(tmp_path, monkeypatch)


@pytest.fixture
def gw(harness, make_mcp):
    """标准网关：默认配置（web-1/db-1 两台服务器）+ 假连接。"""
    return make_mcp()
