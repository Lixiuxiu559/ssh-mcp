"""服务端统一解析到期时间；持久化异常值拒绝授权。"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

_RFC3339 = re.compile(
    r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)"
)


def expiry_epoch(value: str) -> float:
    if not isinstance(value, str) or not _RFC3339.fullmatch(value):
        raise ValueError("到期时间须为带时区的 RFC3339 时间")
    return datetime.fromisoformat(value.upper().replace("Z", "+00:00")).timestamp()


def normalize_expiry(value: str | None) -> str | None:
    if value is None:
        return None
    epoch = expiry_epoch(value)
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds")


def is_expired(value: str | None) -> bool:
    if value is None:
        return False
    try:
        return time.time() >= expiry_epoch(value)
    except (ValueError, TypeError, OverflowError, OSError):
        return True
