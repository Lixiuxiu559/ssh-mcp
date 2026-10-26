"""命令执行工具。"""

from __future__ import annotations

import asyncio
import shlex
import time

from fastmcp import FastMCP
from fastmcp.dependencies import Depends

from ..dependencies import get_state
from ..errors import SshMcpError, SshTimeoutError
from ..ssh.models import ExecResult
from ..state import GatewayState


def register(mcp: FastMCP) -> None:
    @mcp.tool
    async def exec_command(
        server: str,
        command: str,
        timeout_seconds: int = 60,
        cwd: str | None = None,
        state: GatewayState = Depends(get_state),
    ) -> ExecResult:
        """在指定服务器上执行 shell 命令并返回结果。

        Args:
            server: 服务器别名（先用 list_servers 获取）。
            command: 要执行的 shell 命令。
            timeout_seconds: 超时秒数（超过服务端上限会被截断）。
                超时会中断命令，但远端用 nohup/setsid 启动的进程可能继续运行，
                长任务建议自行 nohup 后轮询输出文件。
            cwd: 命令工作目录（可选），内部以 `cd <dir> && <command>` 执行。
        """
        limits = state.config.limits
        # 空命令必须提前拒绝：SSH exec 收到空串会开一个交互式 shell 并等待 stdin，
        # 结果是一直挂到超时（实测 60s 才报错，且提示与真实原因无关）。
        if not command.strip():
            raise SshMcpError("command 不能为空；如需探测连通性请执行具体命令（如 whoami）")

        timeout = min(max(1, timeout_seconds), limits.max_command_timeout_seconds)
        if cwd:
            command = f"cd {shlex.quote(cwd)} && {command}"

        async def op(conn):
            return await conn.run(command, check=False, encoding=None)

        start = time.monotonic()
        try:
            proc = await asyncio.wait_for(
                state.pool.run_with_retry(server, op), timeout=timeout
            )
        except asyncio.TimeoutError:
            raise SshTimeoutError(
                f"命令在 {timeout}s 后超时并已中断；"
                "远端 nohup/setsid 启动的进程可能仍在运行"
            ) from None
        duration = round((time.monotonic() - start) * 1000, 1)

        stdout_b = proc.stdout or b""
        stderr_b = proc.stderr or b""
        truncated = len(stdout_b) > limits.max_output_bytes or len(stderr_b) > limits.max_output_bytes
        return ExecResult(
            stdout=stdout_b[: limits.max_output_bytes].decode("utf-8", "replace"),
            stderr=stderr_b[: limits.max_output_bytes].decode("utf-8", "replace"),
            exit_code=proc.exit_status if proc.exit_status is not None else -1,
            duration_ms=duration,
            truncated=truncated,
        )
