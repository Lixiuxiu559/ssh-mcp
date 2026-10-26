"""审计测试：SQLite 落盘、字段完整性、失败也记录、内容不泄露、分页与保留期。"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from fastmcp import Client
from httpx2 import ASGITransport, AsyncClient


def read_records(audit_path):
    conn = sqlite3.connect(audit_path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM audit_records ORDER BY id").fetchall()]
    finally:
        conn.close()


async def _web_get(app, path: str, token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        return await client.get(path, headers={"Authorization": f"Bearer {token}"})


async def test_audit_records_tool_calls(gw, tmp_path):
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "uptime"})
        await client.call_tool("exec_command", {"server": "nope", "command": "ls"}, raise_on_error=False)

    records = read_records(tmp_path / "audit" / "audit.db")
    assert len(records) == 2

    ok_record, err_record = records
    assert ok_record["tool"] == "exec_command"
    assert ok_record["server"] == "web-1"
    assert ok_record["command"] == "uptime"
    assert ok_record["status"] == "ok"
    assert ok_record["user"] == "anonymous"  # in-memory 无 HTTP 认证
    assert ok_record["duration_ms"] >= 0

    assert err_record["status"] == "error"
    assert "ServerNotFoundError" in err_record["error"]


async def test_audit_does_not_record_file_content(gw, harness, tmp_path):
    harness.fs_dirs = {"/", "/tmp"}
    async with Client(gw.mcp) as client:
        await client.call_tool(
            "upload_file",
            {"server": "web-1", "path": "/tmp/x.sh", "content": "SECRET-CONTENT-123"},
        )
    db = tmp_path / "audit" / "audit.db"
    # 整个数据库文件里都不应出现明文内容
    assert b"SECRET-CONTENT-123" not in db.read_bytes()
    record = read_records(db)[-1]
    assert record["content_bytes"] == len("SECRET-CONTENT-123")
    assert record["content_sha256"]


async def test_audit_visible_via_web(gw, tmp_path):
    app = gw.mcp.http_app()
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "hostname"})

    resp = await _web_get(app, "/api/audit?limit=10", "tok-alice")
    body = resp.json()
    assert body["total"] == 1
    assert body["records"][0]["command"] == "hostname"


async def test_audit_pagination(gw):
    """分页：按新→旧返回，limit/offset 生效，total 为符合条件的总数。"""
    app = gw.mcp.http_app()
    async with Client(gw.mcp) as client:
        for i in range(7):
            await client.call_tool("exec_command", {"server": "web-1", "command": f"cmd{i}"})

    page1 = (await _web_get(app, "/api/audit?limit=3&offset=0", "tok-alice")).json()
    page2 = (await _web_get(app, "/api/audit?limit=3&offset=3", "tok-alice")).json()
    page3 = (await _web_get(app, "/api/audit?limit=3&offset=6", "tok-alice")).json()

    assert page1["total"] == page2["total"] == page3["total"] == 7
    # 最新在前
    assert [r["command"] for r in page1["records"]] == ["cmd6", "cmd5", "cmd4"]
    assert [r["command"] for r in page2["records"]] == ["cmd3", "cmd2", "cmd1"]
    assert [r["command"] for r in page3["records"]] == ["cmd0"]
    # 三页拼起来不重不漏
    all_cmds = [r["command"] for p in (page1, page2, page3) for r in p["records"]]
    assert sorted(all_cmds) == sorted(f"cmd{i}" for i in range(7))


async def test_audit_filter_by_server_and_status(gw):
    app = gw.mcp.http_app()
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "ok-cmd"})
        await client.call_tool("exec_command", {"server": "nope", "command": "x"}, raise_on_error=False)

    body = (await _web_get(app, "/api/audit?server=web-1", "tok-alice")).json()
    assert body["total"] == 1
    assert body["records"][0]["command"] == "ok-cmd"

    body = (await _web_get(app, "/api/audit?status=error", "tok-alice")).json()
    assert body["total"] == 1
    assert body["records"][0]["status"] == "error"


async def test_audit_keyword_and_time_filters(gw):
    app = gw.mcp.http_app()
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "find-me-alpha"})
        await client.call_tool("exec_command", {"server": "web-1", "command": "other-cmd"})

    # 关键词命中命令内容
    body = (await _web_get(app, "/api/audit?q=alpha", "tok-alice")).json()
    assert body["total"] == 1
    assert body["records"][0]["command"] == "find-me-alpha"

    # 关键词也命中工具名 / 用户名
    assert (await _web_get(app, "/api/audit?q=exec_command", "tok-alice")).json()["total"] == 2

    # 时间范围：全部保留 vs 未来下界（days 不匹配则无结果）
    assert (await _web_get(app, "/api/audit?days=30", "tok-alice")).json()["total"] == 2


async def test_audit_csv_export(gw):
    app = gw.mcp.http_app()
    async with Client(gw.mcp) as client:
        await client.call_tool("exec_command", {"server": "web-1", "command": "=SUM(A1:A9)"})
        await client.call_tool("exec_command", {"server": "web-1", "command": "ls -la"})

    resp = await _web_get(app, "/api/audit/export", "tok-alice")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    text = resp.text
    assert "ts,user,tool,server,status" in text.splitlines()[0]
    assert "ls -la" in text
    # 公式注入防护：以 = 开头的内容被加了前缀
    assert "'=SUM(A1:A9)" in text


async def test_audit_retention_prunes_old_records(gw):
    """超过保留期的记录在写入时被清理。"""
    audit = gw.state.audit
    old_ts = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="milliseconds")
    recent_ts = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="milliseconds")

    await audit.log({"ts": old_ts, "user": "u", "tool": "exec_command", "status": "ok"})
    audit._prune(force=True)  # 触发清理
    await audit.log({"ts": recent_ts, "user": "u", "tool": "exec_command", "status": "ok"})
    audit._prune(force=True)

    records, total = audit.query(limit=50)
    assert total == 1
    assert records[0]["ts"] == recent_ts  # 31 天前的已被清掉，1 天前的保留
