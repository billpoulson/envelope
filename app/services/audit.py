"""Structured security audit: JSON lines (`envelope.audit` logger) and optional `audit_events` rows."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.config import get_settings
from app.models import ApiKey, AuditEvent

_audit_logger = logging.getLogger("envelope.audit")

_USAGE_HEADERS = {
    "name": ("x-envelope-usage-name", 128),
    "kind": ("x-envelope-usage-kind", 64),
    "run": ("x-envelope-usage-run", 256),
}


def _safe_client_ip(request: Request) -> str:
    c = request.client
    return c.host if c else ""


def _safe_user_agent(request: Request) -> str:
    ua = (request.headers.get("user-agent") or "").strip()
    return ua[:512] if len(ua) > 512 else ua


def _scope_path(request: Request) -> str:
    p = request.scope.get("path")
    return str(p) if p else ""


def _safe_usage_header(value: str | None, max_len: int) -> str | None:
    if value is None:
        return None
    cleaned = "".join(ch for ch in value.strip() if ch >= " " and ch != "\x7f")
    if not cleaned:
        return None
    return cleaned[:max_len]


def usage_details_from_headers(request: Request) -> dict[str, str] | None:
    usage: dict[str, str] = {}
    for key, (header_name, max_len) in _USAGE_HEADERS.items():
        value = _safe_usage_header(request.headers.get(header_name), max_len)
        if value:
            usage[key] = value
    return usage or None


async def emit_audit_event(
    session: AsyncSession,
    request: Request,
    *,
    event_type: str,
    actor: ApiKey | None = None,
    bundle_id: int | None = None,
    bundle_name: str | None = None,
    stack_id: int | None = None,
    stack_name: str | None = None,
    bundle_env_link_id: int | None = None,
    stack_env_link_id: int | None = None,
    token_sha256_prefix: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Record one audit event. Commits the session when database audit is enabled."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    extra = dict(details or {})
    usage = usage_details_from_headers(request)
    if usage:
        existing_usage = extra.get("usage")
        if isinstance(existing_usage, dict):
            extra["usage"] = {**usage, **existing_usage}
        else:
            extra["usage"] = usage
    details_json = json.dumps(extra, sort_keys=True) if extra else None

    actor_id = actor.id if actor else None
    actor_name = actor.name if actor else None

    bn = bundle_name[:256] if bundle_name and len(bundle_name) > 256 else bundle_name
    sn = stack_name[:256] if stack_name and len(stack_name) > 256 else stack_name
    tprefix = None
    if token_sha256_prefix:
        tprefix = token_sha256_prefix[:8]

    ip = _safe_client_ip(request)[:128] or None
    ua = _safe_user_agent(request) or None
    path = _scope_path(request)[:512] or None

    log_payload: dict[str, Any] = {
        "ts": now.isoformat(),
        "event_type": event_type,
        "actor_api_key_id": actor_id,
        "actor_api_key_name": actor_name,
        "bundle_id": bundle_id,
        "bundle_name": bn,
        "stack_id": stack_id,
        "stack_name": sn,
        "bundle_env_link_id": bundle_env_link_id,
        "stack_env_link_id": stack_env_link_id,
        "token_sha256_prefix": tprefix,
        "client_ip": ip,
        "user_agent": ua,
        "http_method": request.method,
        "path": path,
        "details": extra,
    }
    if settings.audit_log_enabled:
        _audit_logger.info(json.dumps(log_payload, default=str, sort_keys=True))

    if not settings.audit_database_enabled:
        return

    session.add(
        AuditEvent(
            created_at=now,
            event_type=event_type,
            actor_api_key_id=actor_id,
            actor_api_key_name=actor_name,
            bundle_id=bundle_id,
            bundle_name=bn,
            stack_id=stack_id,
            stack_name=sn,
            bundle_env_link_id=bundle_env_link_id,
            stack_env_link_id=stack_env_link_id,
            token_sha256_prefix=tprefix,
            client_ip=ip,
            user_agent=ua,
            http_method=request.method,
            path=path,
            details=details_json,
        )
    )
    await session.commit()
