"""Web 人员审计的显式策略与事务操作接线，不改变存储事务或投递语义。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any, TypeVar

from starlette.requests import Request

T = TypeVar("T")


class PersonAuditMode(Enum):
    OUTBOX = "outbox"
    LIFECYCLE = "lifecycle"


class PersonAuditContractError(RuntimeError):
    """内部路由接线错误；不包含业务参数或秘密值。"""


def validate_audit_mode(action: str | None, mode: PersonAuditMode | None) -> None:
    if action is None:
        if mode is not None:
            raise PersonAuditContractError("审计模式必须与动作一同声明")
    elif not isinstance(action, str) or not action or not isinstance(mode, PersonAuditMode):
        raise PersonAuditContractError("审计动作必须显式声明有效模式")


def _outbox_event(
    request: Request, operation: Callable[..., Any], kwargs: dict[str, Any]
) -> dict[str, Any]:
    if getattr(request.state, "person_audit_mode", None) is not PersonAuditMode.OUTBOX:
        raise PersonAuditContractError("事务审计调用仅可用于 OUTBOX 路由")
    if not callable(operation):
        raise PersonAuditContractError("事务审计操作须为可调用对象")
    record = getattr(request.state, "identity_event", None)
    if not isinstance(record, dict) or "event" in kwargs:
        raise PersonAuditContractError("事务审计事件须由路由统一传入")
    return record


async def call_outbox(
    request: Request, operation: Callable[..., T], *args: Any, **kwargs: Any
) -> T:
    record = _outbox_event(request, operation, kwargs)
    result = await asyncio.to_thread(operation, *args, event=record, **kwargs)
    request.state.outbox_recorded = True
    return result


async def call_outbox_async(
    request: Request, operation: Callable[..., Awaitable[T]], *args: Any, **kwargs: Any
) -> T:
    record = _outbox_event(request, operation, kwargs)
    result = await operation(*args, event=record, **kwargs)
    request.state.outbox_recorded = True
    return result


def ensure_outbox_recorded(request: Request, status_code: int) -> None:
    if (
        getattr(request.state, "person_audit_mode", None) is PersonAuditMode.OUTBOX
        and status_code < 400
        and not getattr(request.state, "outbox_recorded", False)
    ):
        raise PersonAuditContractError("OUTBOX 路由成功返回前未登记事务结果")
