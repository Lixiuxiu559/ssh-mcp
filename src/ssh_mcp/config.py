"""配置模型与 YAML 读写。

设计要点：
- ${ENV_VAR} 插值在 pydantic 校验前做，缺变量直接报错（fail-fast），不支持静默空串
- 保存时写回"原始树"（未插值的 YAML dict），保证 ${ENV} 引用不会落盘成明文
- 网页编辑某台服务器时若未填凭据，保留原凭据（含其 ${ENV} 引用）
"""

from __future__ import annotations

import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import (
    BaseModel,
    Field,
    PrivateAttr,
    SecretStr,
    field_validator,
    model_validator,
)

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
_DOLLAR_SENTINEL = "\x00SSHMCP_DOLLAR\x00"
_ALIAS_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class ConfigError(Exception):
    """配置文件错误。"""


def expand_env_vars(node: Any) -> Any:
    """递归展开字符串中的 ${ENV_VAR} 引用；$$ 转义为字面 $；缺变量报错。"""
    if isinstance(node, str):
        text = node.replace("$$", _DOLLAR_SENTINEL)

        def _repl(match: re.Match[str]) -> str:
            name = match.group(1)
            value = os.environ.get(name)
            if value is None:
                raise ConfigError(f"环境变量 {name} 未设置（配置中引用为 ${{{name}}}）")
            return value

        return _ENV_PATTERN.sub(_repl, text).replace(_DOLLAR_SENTINEL, "$")
    if isinstance(node, dict):
        return {key: expand_env_vars(value) for key, value in node.items()}
    if isinstance(node, list):
        return [expand_env_vars(item) for item in node]
    return node


# ---------------------------------------------------------------- 模型


class ListenerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8808


DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_TOKEN = "admin"


class UserEntry(BaseModel):
    username: str
    token: SecretStr
    admin: bool = False


class AuthConfig(BaseModel):
    users: list[UserEntry] = Field(default_factory=list)
    _using_default_admin: bool = PrivateAttr(default=False)

    @model_validator(mode="after")
    def _ensure_users(self) -> AuthConfig:
        if not self.users:
            # 未配置任何成员：内置默认管理员，保证首次启动能进入管理端配置其他成员
            self.users = [
                UserEntry(
                    username=DEFAULT_ADMIN_USERNAME,
                    token=DEFAULT_ADMIN_TOKEN,
                    admin=True,
                )
            ]
            self._using_default_admin = True
        names = [u.username for u in self.users]
        if len(names) != len(set(names)):
            raise ValueError("auth.users 中存在重复的 username")
        return self

    @property
    def using_default_admin(self) -> bool:
        """当前是否在使用内置默认管理员账号（admin/admin）。"""
        return self._using_default_admin


class AuditConfig(BaseModel):
    path: Path = Path("audit/audit.db")
    retention_days: int = 30  # 只保留最近 N 天，超期记录自动清理


class LimitsConfig(BaseModel):
    default_command_timeout_seconds: int = 60
    max_command_timeout_seconds: int = 600
    max_output_bytes: int = 65536
    max_read_file_bytes: int = 1024 * 1024
    # 上传内容经 MCP 请求体传输，而 MCP 传输层对请求体有 4MiB 硬上限
    # （mcp SDK 的 DEFAULT_MAX_REQUEST_BODY_SIZE，FastMCP 未暴露配置入口）。
    # base64 编码会放大 ~4/3，故原始内容必须远低于 4MiB 才能给出可读报错，
    # 这里默认 2MiB（2MiB base64 ≈ 2.7MiB 请求体，留足余量）。
    # 更大的文件请走 scp/rsync，而不是调大这个值（调大只会撞上传输层的 413）。
    max_upload_bytes: int = 2 * 1024 * 1024
    max_download_bytes: int = 10 * 1024 * 1024  # 下载是响应体，不受请求体上限约束
    max_list_entries: int = 500
    max_sessions_per_server: int = 8


class PrivateKeyFileSpec(BaseModel):
    type: Literal["private_key_file"] = "private_key_file"
    path: str
    passphrase: SecretStr | None = None


class PrivateKeyInlineSpec(BaseModel):
    type: Literal["private_key_inline"] = "private_key_inline"
    private_key: SecretStr
    passphrase: SecretStr | None = None


class PasswordSpec(BaseModel):
    type: Literal["password"] = "password"
    password: SecretStr


CredentialSpec = Annotated[
    PrivateKeyFileSpec | PrivateKeyInlineSpec | PasswordSpec,
    Field(discriminator="type"),
]


class ServerEntry(BaseModel):
    alias: str
    host: str
    port: int = 22
    username: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    known_hosts: str | None = None
    credential: CredentialSpec

    @field_validator("alias")
    @classmethod
    def _alias_ok(cls, value: str) -> str:
        if not _ALIAS_PATTERN.match(value):
            raise ValueError("alias 只能包含字母、数字、下划线和连字符")
        return value

    @field_validator("credential", mode="before")
    @classmethod
    def _removed_credential_hint(cls, value: Any) -> Any:
        """老配置里可能残留已移除的类型，给出可读提示而不是 pydantic 原文。"""
        if isinstance(value, dict) and value.get("type") == "agent":
            raise ValueError(
                "agent 凭据类型已移除（容器/无 agent 环境下不可用），"
                "请改用 private_key_file / private_key_inline / password"
            )
        return value


class GatewayConfig(BaseModel):
    server: ListenerConfig = Field(default_factory=ListenerConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)
    limits: LimitsConfig = Field(default_factory=LimitsConfig)
    servers: list[ServerEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_alias(self) -> GatewayConfig:
        aliases = [s.alias for s in self.servers]
        if len(aliases) != len(set(aliases)):
            dup = {a for a in aliases if aliases.count(a) > 1}
            raise ValueError(f"servers 中存在重复的 alias: {sorted(dup)}")
        return self

    def get_server(self, alias: str) -> ServerEntry | None:
        return next((s for s in self.servers if s.alias == alias), None)

    def summary(self) -> str:
        """掩码凭据的配置摘要，用于调试输出。"""
        lines = [
            f"监听 {self.server.host}:{self.server.port}",
            f"用户 {len(self.auth.users)} 个: {', '.join(u.username for u in self.auth.users)}",
            f"审计日志 {self.audit.path}",
        ]
        for s in self.servers:
            lines.append(
                f"  {s.alias} -> {s.username}@{s.host}:{s.port} "
                f"(凭据: {s.credential.type})"
            )
        return "\n".join(lines)


# ---------------------------------------------------------------- 文件读写

_SERVER_KEYS = (
    "alias",
    "host",
    "port",
    "username",
    "description",
    "tags",
    "known_hosts",
    "credential",
)


def sanitize_server_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """只保留合法字段，避免网页提交未知键污染配置文件。"""
    return {k: v for k, v in entry.items() if k in _SERVER_KEYS and v is not None}


class ConfigFile:
    """YAML 配置文件：读入原始树，插值后校验；保存时写回原始树。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        if not self.path.exists():
            raise ConfigError(f"配置文件不存在: {self.path}")
        try:
            raw = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            raise ConfigError(f"配置文件不是合法的 YAML: {exc}") from exc
        if not isinstance(raw, dict):
            raise ConfigError(f"配置文件内容应为 YAML 映射: {self.path}")
        self.raw: dict[str, Any] = raw

    def load(self) -> GatewayConfig:
        try:
            return GatewayConfig.model_validate(expand_env_vars(deepcopy(self.raw)))
        except ConfigError:
            raise
        except Exception as exc:
            raise ConfigError(f"配置校验失败: {exc}") from exc

    def save(self) -> None:
        """原子写回原始树，并收紧文件权限（配置里可能含明文凭据）。"""
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(
            yaml.safe_dump(self.raw, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def update_users(self, users: list[dict[str, Any]]) -> GatewayConfig:
        """整体替换 auth.users。token 提交什么就存什么（含 ${ENV} 引用原文）。"""
        cleaned: list[dict[str, Any]] = []
        for u in users:
            username = str(u.get("username") or "").strip()
            token = str(u.get("token") or "").strip()
            if not username:
                raise ConfigError("用户名不能为空")
            if not token:
                raise ConfigError(f"用户 {username} 的 token 不能为空")
            entry: dict[str, Any] = {"username": username, "token": token}
            if u.get("admin"):
                entry["admin"] = True
            cleaned.append(entry)
        if not cleaned:
            raise ConfigError("至少要保留一个成员")
        names = [u["username"] for u in cleaned]
        dups = sorted({n for n in names if names.count(n) > 1})
        if dups:
            raise ConfigError(f"用户名重复: {', '.join(dups)}")
        snapshot = deepcopy(self.raw)
        self.raw.setdefault("auth", {})["users"] = cleaned
        try:
            config = self.load()
        except Exception:
            self.raw = snapshot
            raise
        self.save()
        return config

    def upsert_server(self, entry: dict[str, Any]) -> GatewayConfig:
        """新增或更新一台服务器；校验失败会回滚内存中的原始树。"""
        entry = sanitize_server_entry(entry)
        alias = str(entry.get("alias") or "")
        if not alias:
            raise ConfigError("服务器配置缺少 alias")
        servers: list[Any] = self.raw.setdefault("servers", [])
        snapshot = deepcopy(servers)
        try:
            idx = next(
                (i for i, s in enumerate(servers) if s.get("alias") == alias), None
            )
            if idx is not None and not entry.get("credential"):
                # 编辑时未填凭据：保留原凭据（含 ${ENV} 引用）
                entry = {**entry, "credential": servers[idx].get("credential")}
            if idx is not None:
                servers[idx] = entry
            else:
                servers.append(entry)
            config = self.load()
        except Exception:
            self.raw["servers"] = snapshot
            raise
        self.save()
        return config

    def delete_server(self, alias: str) -> GatewayConfig:
        servers: list[Any] = self.raw.get("servers", [])
        snapshot = deepcopy(servers)
        try:
            remaining = [s for s in servers if s.get("alias") != alias]
            if len(remaining) == len(servers):
                raise ConfigError(f"服务器 {alias!r} 不存在")
            self.raw["servers"] = remaining
            config = self.load()
        except Exception:
            self.raw["servers"] = snapshot
            raise
        self.save()
        return config
