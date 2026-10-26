"""服务器清单与健康检查工具。"""

from __future__ import annotations

import asyncio
import stat as stat_module

from fastmcp import FastMCP
from fastmcp.dependencies import Depends

from ..dependencies import get_state
from ..errors import ServerNotFoundError
from ..ssh.models import (
    DiskInfo,
    HealthData,
    HealthEntry,
    HealthResult,
    LoadInfo,
    MemoryInfo,
    ServerInfo,
    ServerListResult,
)
from ..state import GatewayState

_HEALTH_TIMEOUT = 20
# 单条只读命令聚合所有指标，用标记分段解析（目标为 Linux）
_HEALTH_SCRIPT = (
    "echo ===LOAD===; cat /proc/loadavg; "
    "echo ===MEM===; free -b; "
    "echo ===DISK===; df -P; "
    "echo ===CPU===; nproc; "
    "echo ===UP===; cat /proc/uptime"
)
_EXCLUDED_FS = {"tmpfs", "devtmpfs", "udev", "shm", "overlay", "none", "squashfs"}


def _parse_sections(output: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("===") and line.endswith("===") and len(line) > 6:
            current = line.strip("=")
            sections[current] = []
        elif current is not None and line:
            sections[current].append(line)
    return sections


def _parse_health(output: str) -> HealthData:
    sections = _parse_sections(output)
    data = HealthData()

    try:
        parts = sections.get("LOAD", [""])[0].split()
        data.load = LoadInfo(
            one_min=float(parts[0]), five_min=float(parts[1]), fifteen_min=float(parts[2])
        )
    except (IndexError, ValueError):
        pass

    try:
        for line in sections.get("MEM", []):
            if line.startswith("Mem:"):
                cols = line.split()
                total, used, available = int(cols[1]), int(cols[2]), int(cols[-1])
                data.memory = MemoryInfo(
                    total_bytes=total,
                    used_bytes=used,
                    available_bytes=available,
                    used_percent=round(used / total * 100, 1) if total else 0.0,
                )
                break
    except (IndexError, ValueError):
        pass

    for line in sections.get("DISK", [])[1:]:
        cols = line.split()
        if len(cols) < 6:
            continue
        fs, mount = cols[0], " ".join(cols[5:])
        if fs in _EXCLUDED_FS or not mount.startswith("/"):
            continue
        try:
            data.disks.append(
                DiskInfo(
                    filesystem=fs,
                    mount=mount,
                    total_gb=round(int(cols[1]) * 1024 / 1024**3, 1),
                    used_percent=float(cols[4].rstrip("%")),
                )
            )
        except ValueError:
            continue

    try:
        data.cpu_count = int(sections.get("CPU", [""])[0])
    except ValueError:
        pass

    try:
        data.uptime_seconds = float(sections.get("UP", [""])[0].split()[0])
    except (IndexError, ValueError):
        pass

    return data


def _dir_entry_type(permissions: int | None) -> str:
    if permissions is None:
        return "other"
    if stat_module.S_ISLNK(permissions):
        return "symlink"
    if stat_module.S_ISDIR(permissions):
        return "dir"
    if stat_module.S_ISREG(permissions):
        return "file"
    return "other"


def register(mcp: FastMCP) -> None:
    @mcp.tool
    async def list_servers(
        state: GatewayState = Depends(get_state),
    ) -> ServerListResult:
        """列出所有已配置的远端服务器。

        返回别名(alias)、主机、账户、标签与凭据类型（不包含凭据本身）。
        后续所有工具都用 alias 指定服务器。开始任务时建议先调用本工具。
        """
        return ServerListResult(
            servers=[
                ServerInfo(
                    alias=s.alias,
                    host=s.host,
                    port=s.port,
                    username=s.username,
                    description=s.description,
                    tags=s.tags,
                    credential_type=s.credential.type,
                )
                for s in state.config.servers
            ]
        )

    @mcp.tool
    async def server_health(
        server: str | None = None,
        state: GatewayState = Depends(get_state),
    ) -> HealthResult:
        """查看服务器健康状态：负载、内存、磁盘用量、CPU 核数、运行时长。

        Args:
            server: 服务器别名；不填则聚合检查所有服务器（单台失败不影响整体）。
        """
        if server is not None:
            if state.config.get_server(server) is None:
                raise ServerNotFoundError(server, [s.alias for s in state.config.servers])
            aliases = [server]
        else:
            aliases = [s.alias for s in state.config.servers]

        async def check(alias: str) -> HealthEntry:
            async def op(conn):
                return await conn.run(_HEALTH_SCRIPT, check=False, encoding=None)

            try:
                proc = await asyncio.wait_for(
                    state.pool.run_with_retry(alias, op), timeout=_HEALTH_TIMEOUT
                )
                output = (proc.stdout or b"").decode("utf-8", "replace")
                return HealthEntry(alias=alias, status="ok", data=_parse_health(output))
            except Exception as exc:  # noqa: BLE001 - 聚合模式下单机失败记为 error 条目
                return HealthEntry(alias=alias, status="error", error=f"{type(exc).__name__}: {exc}")

        entries = await asyncio.gather(*(check(a) for a in aliases))
        return HealthResult(servers=list(entries))
