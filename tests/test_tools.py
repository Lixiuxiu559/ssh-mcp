"""MCP 工具端到端测试：in-memory Client + Fake SSH 层。"""

from __future__ import annotations

import asyncio
import base64
import hashlib

from fastmcp import Client

from ssh_mcp.tools.inventory import _parse_health


async def call(gw, name: str, **args):
    async with Client(gw.mcp) as client:
        return await client.call_tool(name, args, raise_on_error=False)


async def test_list_servers(gw):
    result = await call(gw, "list_servers")
    assert not result.is_error
    aliases = [s.alias for s in result.data.servers]
    assert aliases == ["web-1", "db-1"]
    assert result.data.servers[0].credential_type == "private_key_file"
    # 绝不泄露凭据
    assert "db-pw" not in str(result.data)


async def test_exec_command(gw):
    result = await call(gw, "exec_command", server="web-1", command="uptime")
    assert not result.is_error
    assert result.data.exit_code == 0
    assert result.data.stdout == "ran: uptime\n"


async def test_exec_cwd_quoting(gw):
    result = await call(gw, "exec_command", server="web-1", command="ls", cwd="/var/log/app dir")
    assert not result.is_error
    assert result.data.stdout == "ran: cd '/var/log/app dir' && ls\n"


async def test_exec_nonzero_exit(gw, harness):
    class Proc:
        stdout = b""
        stderr = b"boom"
        exit_status = 2

    harness.exec_behavior = lambda cmd, *a: Proc()
    result = await call(gw, "exec_command", server="web-1", command="false")
    assert not result.is_error
    assert result.data.exit_code == 2
    assert result.data.stderr == "boom"


async def test_exec_timeout(gw):
    class HangConn:
        async def run(self, command, check=False, encoding=None):
            await asyncio.sleep(30)

        def close(self):
            pass

    gw.state.pool._conns["web-1"] = HangConn()
    result = await call(gw, "exec_command", server="web-1", command="sleep 30", timeout_seconds=1)
    assert result.is_error
    assert "超时" in result.content[0].text


async def test_exec_unknown_server_message(gw):
    result = await call(gw, "exec_command", server="nope", command="ls")
    assert result.is_error
    text = result.content[0].text
    assert "web-1" in text and "db-1" in text


async def test_list_dir_filters_and_sorts(gw, harness):
    harness.fs_files = {
        "/app/b.txt": b"bb",
        "/app/.hidden": b"h",
        "/app/a_placeholder": b"",
    }
    harness.fs_dirs = {"/", "/app", "/app/subdir"}
    result = await call(gw, "list_dir", server="web-1", path="/app")
    assert not result.is_error
    entries = result.data.entries
    assert [e.name for e in entries] == ["subdir", "a_placeholder", "b.txt"]
    assert entries[0].type == "dir"


async def test_list_dir_truncates(gw, harness):
    harness.fs_files = {f"/data/f{i}.txt": b"x" for i in range(5)}
    harness.fs_dirs = {"/", "/data"}
    result = await call(gw, "list_dir", server="web-1", path="/data")
    assert len(result.data.entries) == 3  # limits.max_list_entries=3
    assert result.data.truncated


async def test_read_file_text(gw, harness):
    harness.fs_files["/etc/app.conf"] = b"key=value\n"
    result = await call(gw, "read_file", server="web-1", path="/etc/app.conf")
    assert not result.is_error
    assert result.data.content == "key=value\n"


async def test_read_file_too_large(gw, harness):
    harness.fs_files["/big.log"] = b"x" * 2000  # max_read_file_bytes=1024
    result = await call(gw, "read_file", server="web-1", path="/big.log")
    assert result.is_error
    assert "download_file" in result.content[0].text


async def test_read_file_binary_rejected(gw, harness):
    harness.fs_files["/bin.dat"] = b"\xff\xfe\x00"
    result = await call(gw, "read_file", server="web-1", path="/bin.dat")
    assert result.is_error
    assert "base64" in result.content[0].text


async def test_missing_path_errors_are_readable(gw, harness):
    """不存在的路径要给出可读原因，不能被 mask 成通用的 'Error calling tool'。"""
    harness.fs_dirs = {"/"}

    result = await call(gw, "list_dir", server="web-1", path="/nope")
    assert result.is_error
    assert "远端目录不存在" in result.content[0].text
    assert "/nope" in result.content[0].text

    result = await call(gw, "read_file", server="web-1", path="/nope.txt")
    assert result.is_error
    assert "远端文件不存在" in result.content[0].text

    result = await call(gw, "download_file", server="web-1", path="/nope.bin")
    assert result.is_error
    assert "远端文件不存在" in result.content[0].text


async def test_read_file_on_directory_rejected(gw, harness):
    harness.fs_dirs = {"/", "/somedir"}
    result = await call(gw, "read_file", server="web-1", path="/somedir")
    assert result.is_error
    assert "list_dir" in result.content[0].text


async def test_upload_and_overwrite_protection(gw, harness):
    harness.fs_dirs = {"/", "/tmp"}
    result = await call(
        gw, "upload_file", server="web-1", path="/tmp/new.sh", content="#!/bin/sh\necho hi\n"
    )
    assert not result.is_error
    assert harness.fs_files["/tmp/new.sh"] == b"#!/bin/sh\necho hi\n"
    result2 = await call(gw, "upload_file", server="web-1", path="/tmp/new.sh", content="x")
    assert result2.is_error
    assert "overwrite" in result2.content[0].text
    result3 = await call(
        gw, "upload_file", server="web-1", path="/tmp/new.sh", content="x", overwrite=True
    )
    assert not result3.is_error


async def test_upload_create_dirs(gw, harness):
    result = await call(
        gw, "upload_file", server="web-1", path="/opt/app/x.conf", content="v", create_dirs=True
    )
    assert not result.is_error
    assert "/opt/app/x.conf" in harness.fs_files


async def test_upload_too_large(gw):
    result = await call(gw, "upload_file", server="web-1", path="/tmp/big.bin", content="A" * 3000)
    assert result.is_error
    assert "上限" in result.content[0].text


async def test_download_base64_roundtrip(gw, harness):
    raw = b"\x00\x01\xffbinary"
    harness.fs_files["/data.bin"] = raw
    result = await call(gw, "download_file", server="web-1", path="/data.bin")
    assert not result.is_error
    assert base64.b64decode(result.data.content) == raw
    assert result.data.sha256 == hashlib.sha256(raw).hexdigest()


async def test_download_text_mode_binary_error(gw, harness):
    harness.fs_files["/data.bin"] = b"\xff\xfe"
    result = await call(gw, "download_file", server="web-1", path="/data.bin", encoding="text")
    assert result.is_error
    assert "base64" in result.content[0].text


async def test_download_truncates(gw, harness):
    harness.fs_files["/big.bin"] = b"z" * 3000  # max_download_bytes=2048
    result = await call(gw, "download_file", server="web-1", path="/big.bin")
    assert not result.is_error
    assert result.data.truncated
    assert len(base64.b64decode(result.data.content)) == 2048


async def test_server_health_single(gw):
    result = await call(gw, "server_health", server="web-1")
    assert not result.is_error
    entry = result.data.servers[0]
    assert entry.status == "ok"
    assert entry.data.load.one_min == 0.10
    assert entry.data.memory.used_percent == 50.0
    assert [d.mount for d in entry.data.disks] == ["/"]
    assert entry.data.cpu_count == 8
    assert entry.data.uptime_seconds == 123456.78


async def test_server_health_aggregate_single_failure(gw, harness):
    # db-1(10.0.0.20) 持续失败，不影响 web-1 的结果
    default = harness._default_behavior
    harness.exec_behavior = lambda cmd, host="": (
        OSError("db down") if host == "10.0.0.20" else default(cmd, host)
    )
    result = await call(gw, "server_health")
    assert not result.is_error
    by_alias = {e.alias: e for e in result.data.servers}
    assert by_alias["web-1"].status == "ok"
    assert by_alias["db-1"].status == "error"
    assert "db down" in by_alias["db-1"].error


async def test_parse_health_skips_bad_sections():
    data = _parse_health("===LOAD===\ngarbage\n===CPU===\nnot-a-number\n")
    assert data.load is None
    assert data.cpu_count is None


async def test_exec_empty_command_rejected(gw):
    """空命令必须立即拒绝：SSH exec 空串会开交互 shell 并挂到超时。"""
    result = await call(gw, "exec_command", server="web-1", command="")
    assert result.is_error
    assert "不能为空" in result.content[0].text
    result = await call(gw, "exec_command", server="web-1", command="   ")
    assert result.is_error
    assert "不能为空" in result.content[0].text


async def test_upload_missing_parent_dir_readable_error(gw, harness):
    """上传到不存在的目录：给出可读原因与 create_dirs 建议，而非通用报错。"""
    harness.fs_dirs = {"/"}
    result = await call(
        gw, "upload_file", server="web-1", path="/no/such/dir/a.txt", content="x"
    )
    assert result.is_error
    msg = result.content[0].text
    assert "父目录不存在" in msg
    assert "create_dirs" in msg
