"""单机身份存储：密码保存验证值，Token 另存加密副本，数据库事务由锁串行化。"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import stat
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .expiry import is_expired, normalize_expiry


class IdentityError(ValueError):
    """可以向调用者展示的输入或状态错误。"""


class WorkspaceConflict(IdentityError):
    """空间仍被资源或有效管理记录引用。"""


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _password_hash(password: str, *, minimum_length: int = 6) -> str:
    if not isinstance(password, str) or not minimum_length <= len(password) <= 1024:
        raise IdentityError(f"密码长度须为 {minimum_length}–1024 个字符")
    salt = secrets.token_hex(16)
    key = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return f"scrypt${salt}${key.hex()}"


def _password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, salt, expected = stored.split("$")
        if algorithm != "scrypt" or not isinstance(password, str) or len(password) > 1024:
            return False
        key = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(key.hex(), expected)
    except (ValueError, TypeError):
        return False


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class IdentityStore:
    def __init__(self, path: Path, session_hours: int = 8):
        self.path = Path(path)
        created_directory = not self.path.parent.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if created_directory:
            os.chmod(self.path.parent, 0o700)
        self.session_hours = session_hours
        self.setup_key_path = self.path.parent / "setup.key"
        self.token_key_path = self.path.with_suffix(".token.key")
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        with self._lock:
            self._connection()
            if self.setup_required and not self.setup_key_path.exists():
                try:
                    fd = os.open(self.setup_key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    pass  # 并发启动的另一实例已创建初始化密钥。
                else:
                    with os.fdopen(fd, "w") as handle:
                        handle.write(secrets.token_urlsafe(32))

    def _connection(self) -> sqlite3.Connection:
        if self._conn is None:
            # SQLite copies the main file's permissions when creating WAL/SHM.
            # Secure it before the first connection, including existing installations.
            fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            try:
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)
            self._secure_sidecars()
            conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
                    last_login_at TEXT
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    csrf_token TEXT NOT NULL, expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tokens (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
                    prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
                    enabled INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
                    created_by TEXT, created_at TEXT NOT NULL, last_used_at TEXT,
                    legacy INTEGER NOT NULL DEFAULT 0, workspace_id TEXT, token_ciphertext TEXT,
                    expires_at TEXT
                );
                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS identity_events (
                    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, payload TEXT NOT NULL,
                    delivered INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            # Existing credentials remain stored but unbound, and therefore unusable.
            # Never infer a workspace or grant access during schema upgrades.
            # executescript has committed; serialize schema inspection and ALTER
            # across independent service starts before either observes old columns.
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                columns = {row[1] for row in conn.execute("PRAGMA table_info(tokens)")}
                for column in ("workspace_id", "token_ciphertext", "expires_at"):
                    if column not in columns:
                        conn.execute(f"ALTER TABLE tokens ADD COLUMN {column} TEXT")
            os.chmod(self.path, 0o600)
            self._secure_sidecars()
            self._conn = conn
        return self._conn

    def _secure_sidecars(self) -> None:
        for suffix in ("-wal", "-shm", "-journal"):
            path = Path(str(self.path) + suffix)
            if path.exists():
                os.chmod(path, 0o600)

    @property
    def setup_required(self) -> bool:
        with self._lock:
            return self._connection().execute("SELECT 1 FROM users LIMIT 1").fetchone() is None

    def _user(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "enabled": bool(row["enabled"]),
            "last_login_at": row["last_login_at"],
            "created_at": row["created_at"],
        }

    def _token(self, row: sqlite3.Row) -> dict[str, Any]:
        keys = (
            "id", "name", "description", "prefix", "created_by", "created_at", "last_used_at",
            "workspace_id", "expires_at",
        )
        item = {key: row[key] for key in keys}
        item.update(
            enabled=bool(row["enabled"]), revoked=bool(row["revoked"]), legacy=bool(row["legacy"]),
            can_copy=bool(row["token_ciphertext"]) and not bool(row["revoked"]),
            expired=is_expired(row["expires_at"]),
        )
        return item

    def _token_cipher(self, conn: sqlite3.Connection, *, create: bool = False) -> Fernet:
        """惰性读取独立密钥；已存在密文时绝不自动替换丢失的密钥。"""
        try:
            fd = os.open(self.token_key_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            has_ciphertext = conn.execute(
                "SELECT 1 FROM tokens WHERE token_ciphertext IS NOT NULL LIMIT 1"
            ).fetchone()
            if not create or has_ciphertext:
                raise IdentityError("Token 加密密钥缺失，请恢复原密钥后重试") from None
            # create_token 持有 BEGIN IMMEDIATE，跨存储实例的首次签发同样串行。
            # O_EXCL 也保护密钥文件不被其他进程覆盖。
            try:
                fd = os.open(
                    self.token_key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
                )
            except FileExistsError:
                return self._token_cipher(conn)
            key = Fernet.generate_key()
            with os.fdopen(fd, "wb") as handle:
                handle.write(key)
                handle.flush()
                os.fsync(handle.fileno())
            return Fernet(key)
        with os.fdopen(fd, "rb") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise IdentityError("Token 加密密钥文件无效，请恢复原密钥后重试")
            os.fchmod(handle.fileno(), 0o600)
            key = handle.read(1024)
        try:
            if len(key) != 44:
                raise ValueError
            cipher = Fernet(key)
        except (ValueError, TypeError):
            raise IdentityError("Token 加密密钥损坏，请恢复原密钥后重试") from None
        if create:
            existing = conn.execute(
                "SELECT token_ciphertext,token_hash FROM tokens "
                "WHERE token_ciphertext IS NOT NULL LIMIT 1"
            ).fetchone()
            if existing:
                try:
                    value = cipher.decrypt(existing["token_ciphertext"]).decode()
                except (InvalidToken, UnicodeDecodeError, TypeError):
                    raise IdentityError("Token 加密密钥与现有副本不匹配，请恢复原密钥后重试") from None
                if not hmac.compare_digest(_digest(value), existing["token_hash"]):
                    raise IdentityError("Token 加密副本校验失败，请检查已有凭证数据")
        return cipher

    def _event(
        self,
        conn: sqlite3.Connection,
        record: dict[str, Any] | None,
        *,
        actor: dict[str, Any] | None = None,
        object_id: str | None = None,
    ) -> None:
        if record is not None:
            record.setdefault("ts", _now())
            if actor:
                record["actor_user_id"] = actor["id"]
                record["username"] = actor["username"]
            if object_id:
                record["object_id"] = object_id
            conn.execute(
                "INSERT INTO identity_events(ts,payload) VALUES(?,?)",
                (_now(), json.dumps(record, ensure_ascii=False)),
            )

    def ensure_default_account(self) -> None:
        """仅为空身份库创建默认账号；重启不重置或补建已有用户。"""
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if not self.setup_required:
                    self.setup_key_path.unlink(missing_ok=True)
                    return
                user_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO users VALUES(?,?,?,?,1,?,NULL)",
                    (user_id, "admin", "admin", _password_hash("admin", minimum_length=5), _now()),
                )
                self._event(conn, {
                    "event_id": uuid.uuid4().hex,
                    "action": "user.initialize",
                    "object_type": "user",
                    "status": "ok",
                    "summary": "首次启动创建默认登录账号 admin",
                }, object_id=user_id)
            self.setup_key_path.unlink(missing_ok=True)

    def initialize(
        self, username: str, password: str, setup_key: str, event: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if not self.setup_required:
                    raise IdentityError("初始化已经完成")
                expected = self.setup_key_path.read_text()
                if not isinstance(setup_key, str) or not hmac.compare_digest(expected, setup_key):
                    raise IdentityError("初始化凭证无效，请从服务运行目录获取 setup.key")
                user = self._create_user(conn, username, password, username)
                self._event(conn, event, actor=user, object_id=user["id"])
            self.setup_key_path.unlink(missing_ok=True)
            return user

    def _create_user(self, conn, username, password, display_name):
        if not isinstance(username, str) or not username.strip() or len(username) > 128:
            raise IdentityError("用户名须为 1–128 个字符")
        if not isinstance(display_name, str) or len(display_name) > 128:
            raise IdentityError("显示名不能超过 128 个字符")
        user_id = str(uuid.uuid4())
        try:
            conn.execute(
                "INSERT INTO users VALUES(?,?,?,?,1,?,NULL)",
                (
                    user_id,
                    username.strip(),
                    display_name or username.strip(),
                    _password_hash(password),
                    _now(),
                ),
            )
        except sqlite3.IntegrityError:
            raise IdentityError("用户名已存在") from None
        return self._user(conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    def create_user(
        self,
        username: str,
        password: str,
        display_name: str = "",
        event: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            conn = self._connection()
            with conn:
                user = self._create_user(conn, username, password, display_name)
                self._event(conn, event, object_id=user["id"])
            return user

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                self._user(r)
                for r in self._connection().execute("SELECT * FROM users ORDER BY created_at")
            ]

    def update_user(
        self, user_id: str, changes: dict[str, Any], event: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                if row is None:
                    raise IdentityError("用户不存在")
                if "enabled" in changes and not isinstance(changes["enabled"], bool):
                    raise IdentityError("enabled 必须是布尔值")
                enabled = changes.get("enabled", bool(row["enabled"]))
                count = conn.execute("SELECT count(*) FROM users WHERE enabled=1").fetchone()[0]
                if row["enabled"] and not enabled and count <= 1:
                    raise IdentityError("不能停用最后一个可登录用户")
                display = changes.get("display_name", row["display_name"])
                if not isinstance(display, str) or len(display) > 128:
                    raise IdentityError("显示名不能超过 128 个字符")
                password_hash = (
                    _password_hash(changes["password"])
                    if "password" in changes
                    else row["password_hash"]
                )
                conn.execute(
                    "UPDATE users SET display_name=?,enabled=?,password_hash=? WHERE id=?",
                    (display, int(enabled), password_hash, user_id),
                )
                if not enabled or "password" in changes:
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                self._event(conn, event)
            return self._user(conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    def delete_user(self, user_id: str, event: dict[str, Any] | None = None) -> None:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                if row is None:
                    raise IdentityError("用户不存在")
                count = conn.execute("SELECT count(*) FROM users WHERE enabled=1").fetchone()[0]
                if row["enabled"] and count <= 1:
                    raise IdentityError("不能删除最后一个可登录用户")
                conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                conn.execute("DELETE FROM users WHERE id=?", (user_id,))
                if event is not None:
                    event["summary"] = f"删除成员 {row['username']}；已撤销网页登录会话"
                self._event(conn, event, object_id=user_id)

    def login(
        self, username: str, password: str, event: dict[str, Any] | None = None
    ) -> tuple[dict[str, Any], str, str]:
        with self._lock:
            conn = self._connection()
            row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            # Dummy hash still performs the expensive password derivation for unknown users.
            stored = row["password_hash"] if row else "scrypt$" + "00" * 16 + "$" + "00" * 64
            valid = _password_matches(password, stored)
            if row is None or not valid or not row["enabled"]:
                raise IdentityError("用户名或密码错误")
            session, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            with conn:
                conn.execute("DELETE FROM sessions WHERE expires_at<=?", (time.time(),))
                conn.execute(
                    "INSERT INTO sessions VALUES(?,?,?,?)",
                    (_digest(session), row["id"], csrf, time.time() + self.session_hours * 3600),
                )
                conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (_now(), row["id"]))
                self._event(conn, event, actor=self._user(row), object_id=row["id"])
            user = self._user(
                conn.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
            )
            return user, session, csrf

    def session(self, value: str | None) -> tuple[dict[str, Any], str] | None:
        if not value:
            return None
        with self._lock:
            row = (
                self._connection()
                .execute(
                    """SELECT u.*, s.csrf_token FROM sessions s
                JOIN users u ON u.id=s.user_id WHERE s.session_hash=? AND s.expires_at>? AND u.enabled=1""",
                    (_digest(value), time.time()),
                )
                .fetchone()
            )
            return (self._user(row), row["csrf_token"]) if row else None

    def logout(self, value: str, event: dict[str, Any] | None = None) -> None:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("DELETE FROM sessions WHERE session_hash=?", (_digest(value),))
                self._event(conn, event)

    def list_workspaces(self) -> list[dict[str, str]]:
        with self._lock:
            return [dict(row) for row in self._connection().execute(
                "SELECT id,name FROM workspaces ORDER BY rowid"
            )]

    def workspace_info(self, workspace_id: str) -> dict[str, str] | None:
        with self._lock:
            row = self._connection().execute(
                "SELECT id,name FROM workspaces WHERE id=?", (workspace_id,)
            ).fetchone()
            return dict(row) if row else None

    @staticmethod
    def _workspace_name(name: str) -> str:
        if not isinstance(name, str) or not name.strip() or len(name) > 128:
            raise IdentityError("空间名称须为 1–128 个字符")
        return name.strip()

    def create_workspace(self, name: str, event: dict[str, Any] | None = None) -> dict[str, str]:
        name = self._workspace_name(name)
        workspace_id = str(uuid.uuid4())
        with self._lock:
            conn = self._connection()
            try:
                with conn:
                    conn.execute("INSERT INTO workspaces VALUES(?,?)", (workspace_id, name))
                    if event is not None:
                        event["summary"] = f"创建空间 {name}"
                    self._event(conn, event, object_id=workspace_id)
            except sqlite3.IntegrityError:
                raise WorkspaceConflict("空间名称已存在") from None
        return {"id": workspace_id, "name": name}

    def update_workspace(
        self, workspace_id: str, name: str, event: dict[str, Any] | None = None
    ) -> dict[str, str]:
        name = self._workspace_name(name)
        with self._lock:
            conn = self._connection()
            try:
                with conn:
                    if conn.execute(
                        "UPDATE workspaces SET name=? WHERE id=?", (name, workspace_id)
                    ).rowcount != 1:
                        raise IdentityError("空间不存在")
                    if event is not None:
                        event["summary"] = f"空间更名为 {name}"
                    self._event(conn, event, object_id=workspace_id)
            except sqlite3.IntegrityError:
                raise WorkspaceConflict("空间名称已存在") from None
        return {"id": workspace_id, "name": name}

    def delete_workspace(self, workspace_id: str, event: dict[str, Any] | None = None) -> None:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                workspace = self.workspace_info(workspace_id)
                if workspace is None:
                    raise IdentityError("空间不存在")
                if conn.execute(
                    "SELECT 1 FROM tokens WHERE workspace_id=? AND revoked=0", (workspace_id,)
                ).fetchone():
                    raise WorkspaceConflict("空间仍有未删除的 Token，请先删除 Token")
                conn.execute("DELETE FROM workspaces WHERE id=?", (workspace_id,))
                if event is not None:
                    event["summary"] = f"删除空间 {workspace['name']}"
                self._event(conn, event, object_id=workspace_id)

    def list_tokens(self, *, include_deleted: bool = True) -> list[dict[str, Any]]:
        with self._lock:
            return [
                self._token(r)
                for r in self._connection().execute(
                    "SELECT * FROM tokens WHERE (? OR revoked=0) ORDER BY created_at",
                    (include_deleted,),
                )
            ]

    def create_token(
        self, name: str, created_by: str, description: str = "", event: dict[str, Any] | None = None,
        *, workspace_id: str, expires_at: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        if not isinstance(name, str) or not name.strip() or len(name) > 128:
            raise IdentityError("Token 名称须为 1–128 个字符")
        if not isinstance(description, str) or len(description) > 1000:
            raise IdentityError("备注不能超过 1000 个字符")
        token_id, value = str(uuid.uuid4()), "sshmcp_" + secrets.token_urlsafe(32)
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if not isinstance(workspace_id, str) or not self.workspace_info(workspace_id):
                    raise IdentityError("必须选择存在的空间")
                expires_at = self._validate_expiry(expires_at)
                conn.execute(
                    """INSERT INTO tokens
                    (id,name,description,prefix,token_hash,enabled,revoked,created_by,created_at,
                     last_used_at,legacy,workspace_id,token_ciphertext,expires_at)
                     VALUES(?,?,?,?,?,1,0,?,?,NULL,0,?,?,?)""",
                    (
                        token_id,
                        name.strip(),
                        description,
                        "sshmcp_…" + value[-4:],
                        _digest(value),
                        created_by,
                        _now(),
                        workspace_id,
                        self._token_cipher(conn, create=True).encrypt(value.encode()).decode(),
                        expires_at,
                    ),
                )
                if event is not None:
                    event["summary"] = (
                        f"创建 Token；空间 {self.workspace_info(workspace_id)['name']} ({workspace_id})"
                    )
                self._event(conn, event, object_id=token_id)
            return value, self.token_info(token_id)

    def reveal_token(self, token_id: str, event: dict[str, Any] | None = None) -> str:
        """仅后台显式复制时解密；成功审计落入 outbox 后才返回秘密。"""
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM tokens WHERE id=?", (token_id,)).fetchone()
                if row is None:
                    raise IdentityError("Token 不存在")
                if row["revoked"]:
                    raise IdentityError("Token 已删除，无法复制")
                if not row["token_ciphertext"]:
                    raise IdentityError("此 Token 未保存加密副本，无法恢复，请创建新 Token")
                cipher = self._token_cipher(conn)
                try:
                    value = cipher.decrypt(row["token_ciphertext"]).decode()
                except (InvalidToken, UnicodeDecodeError, TypeError):
                    raise IdentityError("Token 无法解密，请检查加密副本与原密钥") from None
                # 同一密钥下的合法密文也不能被交换到其他凭证行。
                if not hmac.compare_digest(_digest(value), row["token_hash"]):
                    raise IdentityError("Token 加密副本与验证值不匹配，无法复制")
                self._event(conn, event, object_id=token_id)
            return value

    def token_info(self, token_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = (
                self._connection()
                .execute("SELECT * FROM tokens WHERE id=?", (token_id,))
                .fetchone()
            )
            return self._token(row) if row else None

    def active_token_info(self, token_id: str) -> dict[str, Any] | None:
        """一次读取当前凭证状态和空间存在性，不更新最近调用时间。"""
        with self._lock:
            row = self._connection().execute(
                """SELECT t.* FROM tokens t JOIN workspaces w ON w.id=t.workspace_id
                WHERE t.id=? AND t.enabled=1 AND t.revoked=0""",
                (token_id,),
            ).fetchone()
            return self._token(row) if row and not is_expired(row["expires_at"]) else None

    def verify_token(self, value: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connection()
            row = conn.execute(
                """SELECT * FROM tokens WHERE token_hash=? AND enabled=1 AND revoked=0
                AND workspace_id IN (SELECT id FROM workspaces)""",
                (_digest(value),),
            ).fetchone()
            if row is None or is_expired(row["expires_at"]):
                return None
            with conn:
                conn.execute("UPDATE tokens SET last_used_at=? WHERE id=?", (_now(), row["id"]))
            return self._token(row)

    def token_for_audit(self, value: str) -> dict[str, Any] | None:
        """识别被拒绝凭证的稳定身份，不启用凭证或更新最近调用时间。"""
        with self._lock:
            row = (
                self._connection()
                .execute("SELECT * FROM tokens WHERE token_hash=?", (_digest(value),))
                .fetchone()
            )
            return self._token(row) if row else None

    def update_token(
        self, token_id: str, changes: dict[str, Any], event: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if "workspace_id" in changes:
            raise IdentityError("Token 所属空间不可修改，请创建新 Token")
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM tokens WHERE id=?", (token_id,)).fetchone()
                if row is None:
                    raise IdentityError("Token 不存在")
                if row["revoked"]:
                    raise IdentityError("Token 已删除，不能重新启用或修改")
                name, description = (
                    changes.get("name", row["name"]),
                    changes.get("description", row["description"]),
                )
                enabled = changes.get("enabled", bool(row["enabled"]))
                if not isinstance(name, str) or not name.strip() or len(name) > 128:
                    raise IdentityError("Token 名称须为 1–128 个字符")
                if not isinstance(description, str) or len(description) > 1000:
                    raise IdentityError("备注不能超过 1000 个字符")
                if not isinstance(enabled, bool):
                    raise IdentityError("enabled 必须是布尔值")
                expires_at = row["expires_at"]
                if "expires_at" in changes:
                    expires_at = self._validate_expiry(changes["expires_at"], previous=expires_at)
                conn.execute(
                    "UPDATE tokens SET name=?,description=?,enabled=?,expires_at=? WHERE id=?",
                    (name.strip(), description, int(enabled), expires_at, token_id),
                )
                self._event(conn, event)
            return self.token_info(token_id)

    @staticmethod
    def _validate_expiry(value: str | None, *, previous: str | None = None) -> str | None:
        try:
            normalized = normalize_expiry(value)
        except (ValueError, TypeError, OverflowError, OSError):
            raise IdentityError("到期时间须为带时区的 RFC3339 时间或 null") from None
        # Re-sending the same deadline permits editing expired credentials, while
        # every newly selected deadline must be strictly in the future.
        if normalized is not None and normalized != previous and is_expired(normalized):
            raise IdentityError("到期时间必须晚于当前时间")
        return normalized

    def revoke_token(self, token_id: str, event: dict[str, Any] | None = None) -> None:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if conn.execute("SELECT 1 FROM tokens WHERE id=?", (token_id,)).fetchone() is None:
                    raise IdentityError("Token 不存在")
                conn.execute(
                    "UPDATE tokens SET enabled=0,revoked=1,token_ciphertext=NULL WHERE id=?",
                    (token_id,),
                )
                self._event(conn, event, object_id=token_id)

    def delete_token(self, token_id: str, event: dict[str, Any] | None = None) -> None:
        """保留验证值墓碑，防止删除后的凭据被旧配置再次导入。"""
        self.revoke_token(token_id, event)

    def pending_events(self) -> list[tuple[int, dict[str, Any]]]:
        with self._lock:
            return [
                (row["id"], json.loads(row["payload"]))
                for row in self._connection().execute(
                    "SELECT id,payload FROM identity_events WHERE delivered=0 ORDER BY id LIMIT 1000"
                )
            ]

    def acknowledge_event(self, event_id: int) -> None:
        with self._lock:
            conn = self._connection()
            with conn:
                conn.execute("DELETE FROM identity_events WHERE id=?", (event_id,))

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
