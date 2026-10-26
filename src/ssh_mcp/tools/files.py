"""文件操作工具：浏览目录、读取、上传、下载。

网关形态下没有"用户本机"路径，文件内容一律经工具参数传输：
upload 传 content，download 返回 content。大小上限由服务端 limits 配置。
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import posixpath
import stat as stat_module
from datetime import datetime

import asyncssh
from fastmcp import FastMCP
from fastmcp.dependencies import Depends

from ..dependencies import get_state
from ..errors import BinaryFileError, FileTooLargeError, SshMcpError
from ..ssh.models import (
    DirEntry,
    DownloadFileResult,
    ListDirResult,
    ReadFileResult,
    UploadFileResult,
)
from ..state import GatewayState

_WRITE_CHUNK = 256 * 1024


def _decode_content(content: str, encoding: str) -> bytes:
    if encoding == "text":
        return content.encode("utf-8")
    if encoding == "base64":
        try:
            return base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SshMcpError(f"无效的 base64 内容: {exc}") from exc
    raise SshMcpError(f"不支持的 encoding: {encoding!r}（可选 text / base64）")


def _entry_type(permissions: int | None) -> str:
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
    async def list_dir(
        server: str,
        path: str = ".",
        show_hidden: bool = False,
        state: GatewayState = Depends(get_state),
    ) -> ListDirResult:
        """列出远端目录内容（目录优先排序，含类型/大小/修改时间）。

        Args:
            server: 服务器别名。
            path: 目录路径，默认当前目录。
            show_hidden: 是否包含 . 开头的隐藏项，默认不包含。
        """
        limits = state.config.limits

        async def op(conn):
            async with conn.start_sftp_client() as sftp:
                # readdir 返回带 filename/attrs 的条目；listdir 只返回文件名，无法取类型与大小
                try:
                    return await sftp.readdir(path)
                except asyncssh.SFTPNoSuchFile as exc:
                    raise SshMcpError(f"远端目录不存在或无权限访问: {path}") from exc

        names = await state.pool.run_with_retry(server, op)
        entries = []
        for name in names:
            if not show_hidden and name.filename.startswith("."):
                continue
            entries.append(
                DirEntry(
                    name=name.filename,
                    type=_entry_type(name.attrs.permissions),
                    size=name.attrs.size or 0,
                    modified=(
                        datetime.fromtimestamp(name.attrs.mtime).astimezone().strftime("%Y-%m-%d %H:%M:%S")
                        if name.attrs.mtime
                        else None
                    ),
                )
            )
        entries.sort(key=lambda e: (e.type != "dir", e.name))
        truncated = len(entries) > limits.max_list_entries
        return ListDirResult(
            path=path, entries=entries[: limits.max_list_entries], truncated=truncated
        )

    @mcp.tool
    async def read_file(
        server: str,
        path: str,
        state: GatewayState = Depends(get_state),
    ) -> ReadFileResult:
        """读取远端 UTF-8 文本文件（如配置文件、日志），上限默认 1MiB。

        超限会报错并提示改用 download_file；二进制文件请直接用 download_file。

        Args:
            server: 服务器别名。
            path: 文件绝对路径或相对家目录的路径。
        """
        limits = state.config.limits

        async def op(conn):
            async with conn.start_sftp_client() as sftp:
                try:
                    attrs = await sftp.stat(path)
                except asyncssh.SFTPNoSuchFile as exc:
                    raise SshMcpError(f"远端文件不存在: {path}") from exc
                if stat_module.S_ISDIR(attrs.permissions or 0):
                    raise SshMcpError(f"{path} 是目录，请用 list_dir 浏览")
                size = attrs.size or 0
                if size > limits.max_read_file_bytes:
                    raise FileTooLargeError(
                        f"文件 {path} 有 {size} 字节，超过 read_file 上限"
                        f" {limits.max_read_file_bytes} 字节，请用 download_file"
                    )
                async with sftp.open(path, "rb") as f:
                    return size, await f.read()

        size, data = await state.pool.run_with_retry(server, op)
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise BinaryFileError(
                f"文件 {path} 不是 UTF-8 文本（{exc}），请用 download_file(encoding='base64')"
            ) from exc
        return ReadFileResult(path=path, size=size, content=content)

    @mcp.tool
    async def upload_file(
        server: str,
        path: str,
        content: str,
        encoding: str = "text",
        overwrite: bool = False,
        create_dirs: bool = False,
        state: GatewayState = Depends(get_state),
    ) -> UploadFileResult:
        """上传文件内容到远端路径（内容经参数传输，上限默认 10MiB）。

        Args:
            server: 服务器别名。
            path: 远端目标路径（绝对路径或相对家目录）。
            content: 文件内容；encoding=text 时为 UTF-8 文本，base64 时为 base64 编码。
            encoding: "text" 或 "base64"。
            overwrite: 目标已存在时是否覆盖，默认拒绝覆盖。
            create_dirs: 是否自动创建父目录。
        """
        limits = state.config.limits
        data = _decode_content(content, encoding)
        if len(data) > limits.max_upload_bytes:
            raise FileTooLargeError(
                f"上传内容 {len(data)} 字节，超过上限 {limits.max_upload_bytes} 字节"
            )
        sha256 = hashlib.sha256(data).hexdigest()

        async def op(conn):
            async with conn.start_sftp_client() as sftp:
                exists = False
                try:
                    await sftp.stat(path)
                    exists = True
                except asyncssh.SFTPNoSuchFile:
                    pass
                if exists and not overwrite:
                    raise SshMcpError(f"远端文件 {path} 已存在；确认要覆盖请传 overwrite=true")
                if create_dirs:
                    parent = posixpath.dirname(path)
                    if parent and parent not in (".", "/"):
                        await sftp.makedirs(parent, exist_ok=True)
                try:
                    async with sftp.open(path, "wb") as f:
                        for i in range(0, len(data), _WRITE_CHUNK):
                            await f.write(data[i : i + _WRITE_CHUNK])
                except asyncssh.SFTPNoSuchFile as exc:
                    # 父目录不存在（未开 create_dirs）等：给出可读原因与修复建议
                    raise SshMcpError(
                        f"无法写入 {path}: 父目录不存在。"
                        "请先创建目录，或传 create_dirs=true 自动创建父目录"
                    ) from exc
                except asyncssh.SFTPPermissionDenied as exc:
                    raise SshMcpError(f"无法写入 {path}: 权限不足") from exc

        await state.pool.run_with_retry(server, op)
        return UploadFileResult(path=path, bytes_written=len(data), sha256=sha256)

    @mcp.tool
    async def download_file(
        server: str,
        path: str,
        encoding: str = "base64",
        max_bytes: int | None = None,
        state: GatewayState = Depends(get_state),
    ) -> DownloadFileResult:
        """下载远端文件内容（默认 base64，适合二进制；上限默认 10MiB）。

        Args:
            server: 服务器别名。
            path: 远端文件路径。
            encoding: "base64"（默认，适合任何文件）或 "text"（要求 UTF-8 文本）。
            max_bytes: 本次最多读取的字节数，不填用服务端上限。
        """
        limits = state.config.limits
        limit = max_bytes if max_bytes is not None else limits.max_download_bytes

        async def op(conn):
            async with conn.start_sftp_client() as sftp:
                try:
                    attrs = await sftp.stat(path)
                except asyncssh.SFTPNoSuchFile as exc:
                    raise SshMcpError(f"远端文件不存在: {path}") from exc
                size = attrs.size or 0
                async with sftp.open(path, "rb") as f:
                    return size, await f.read(limit)
        size, data = await state.pool.run_with_retry(server, op)
        if encoding == "text":
            try:
                content = data.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise BinaryFileError(
                    f"文件 {path} 不是 UTF-8 文本，请改用 encoding='base64'"
                ) from exc
        elif encoding == "base64":
            content = base64.b64encode(data).decode("ascii")
        else:
            raise SshMcpError(f"不支持的 encoding: {encoding!r}（可选 text / base64）")
        return DownloadFileResult(
            path=path,
            size=size,
            encoding=encoding,
            content=content,
            sha256=hashlib.sha256(data).hexdigest(),
            truncated=size > len(data),
        )
