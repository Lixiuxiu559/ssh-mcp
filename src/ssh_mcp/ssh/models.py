"""工具返回的数据模型（pydantic），FastMCP 会自动生成结构化输出 schema。"""

from typing import Literal

from pydantic import BaseModel, Field


class ExecResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float
    truncated: bool = Field(default=False, description="stdout 或 stderr 是否被截断")


class DirEntry(BaseModel):
    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int
    modified: str | None = None


class ListDirResult(BaseModel):
    path: str
    entries: list[DirEntry]
    truncated: bool = False


class ReadFileResult(BaseModel):
    path: str
    size: int
    content: str
    truncated: bool = False


class UploadFileResult(BaseModel):
    path: str
    bytes_written: int
    sha256: str


class DownloadFileResult(BaseModel):
    path: str
    size: int
    encoding: Literal["text", "base64"]
    content: str
    sha256: str
    truncated: bool = False


class ServerInfo(BaseModel):
    alias: str
    host: str
    port: int
    username: str
    description: str
    tags: list[str]
    credential_type: str


class ServerListResult(BaseModel):
    servers: list[ServerInfo]


class LoadInfo(BaseModel):
    one_min: float
    five_min: float
    fifteen_min: float


class MemoryInfo(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    used_percent: float


class DiskInfo(BaseModel):
    filesystem: str
    mount: str
    total_gb: float
    used_percent: float


class HealthData(BaseModel):
    load: LoadInfo | None = None
    memory: MemoryInfo | None = None
    disks: list[DiskInfo] = Field(default_factory=list)
    cpu_count: int | None = None
    uptime_seconds: float | None = None


class HealthEntry(BaseModel):
    alias: str
    status: Literal["ok", "error"]
    data: HealthData | None = None
    error: str | None = None


class HealthResult(BaseModel):
    servers: list[HealthEntry]
