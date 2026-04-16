"""Admin-only disaster recovery: full SQLite backup, optional restore, audit log read API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db, get_session_factory
from app.deps import require_admin
from app.limiter import limiter
from app.models import ApiKey, AuditEvent
from app.services.audit import emit_audit_event
from app.services.backup_crypto import (
    WrongPassphraseError,
    decrypt_bytes,
    encrypt_bytes_async,
)
from app.services.backup_db import (
    database_url_to_sqlite_path,
    replace_sqlite_database,
    snapshot_sqlite_bytes,
)

router = APIRouter(prefix="/system")


class EncryptedBackupBody(BaseModel):
    passphrase: str = Field(..., min_length=1, max_length=1024)


class AuditEventItem(BaseModel):
    id: int
    created_at: datetime
    event_type: str
    actor_api_key_id: int | None = None
    actor_api_key_name: str | None = None
    bundle_id: int | None = None
    bundle_name: str | None = None
    stack_id: int | None = None
    stack_name: str | None = None
    bundle_env_link_id: int | None = None
    stack_env_link_id: int | None = None
    token_sha256_prefix: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    http_method: str | None = None
    path: str | None = None
    details: dict[str, Any] | None = None


class AuditEventsResponse(BaseModel):
    events: list[AuditEventItem]


def _parse_audit_details(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _backup_filename(prefix: str = "envelope") -> str:
    d = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}-{d}.db"


@router.get("/backup/database")
@limiter.limit("60/hour")
async def download_database_backup(
    request: Request,
    key: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> Response:
    settings = get_settings()
    if not settings.backup_enabled:
        raise HTTPException(status_code=403, detail="Backup API is disabled")
    if database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(
            status_code=400,
            detail="Backup is only available for file-backed SQLite databases",
        )
    await emit_audit_event(
        session,
        request,
        event_type="system.database_backup",
        actor=key,
        details={"encrypted": False},
    )
    data = await snapshot_sqlite_bytes()
    fn = _backup_filename()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{fn}"',
            "Content-Length": str(len(data)),
        },
    )


@router.post("/backup/database")
@limiter.limit("60/hour")
async def download_encrypted_database_backup(
    request: Request,
    body: EncryptedBackupBody,
    key: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> Response:
    settings = get_settings()
    if not settings.backup_enabled:
        raise HTTPException(status_code=403, detail="Backup API is disabled")
    if database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(
            status_code=400,
            detail="Backup is only available for file-backed SQLite databases",
        )
    await emit_audit_event(
        session,
        request,
        event_type="system.database_backup",
        actor=key,
        details={"encrypted": True},
    )
    raw = await snapshot_sqlite_bytes()
    try:
        enc = await encrypt_bytes_async(raw, body.passphrase)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    fn = _backup_filename().replace(".db", ".envelope-db")
    return Response(
        content=enc,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{fn}"',
            "Content-Length": str(len(enc)),
        },
    )


@router.post("/restore/database")
@limiter.limit("6/hour")
async def restore_database(
    request: Request,
    key: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    settings = get_settings()
    if not settings.restore_enabled:
        raise HTTPException(
            status_code=403,
            detail="Restore API is disabled (set ENVELOPE_RESTORE_ENABLED=true)",
        )
    if database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(
            status_code=400,
            detail="Restore is only supported for file-backed SQLite databases",
        )
    # Return pooled connection before replacing the SQLite file (required on Windows).
    await session.close()
    form = await request.form()
    upload = form.get("file")
    if upload is None:
        raise HTTPException(status_code=400, detail='multipart field "file" is required')
    raw_bytes = await upload.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="empty file")
    pp_field = form.get("passphrase")
    passphrase = str(pp_field).strip() if pp_field is not None else ""
    content = raw_bytes
    if passphrase:
        try:
            content = decrypt_bytes(raw_bytes, passphrase)
        except WrongPassphraseError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"decryption failed: {e}") from e
    try:
        await replace_sqlite_database(new_content=content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    async with get_session_factory()() as audit_session:
        await emit_audit_event(
            audit_session,
            request,
            event_type="system.database_restore",
            actor=key,
            details={},
        )
    return {"status": "ok", "message": "Database restored; new connections use the replaced file."}


@router.get("/audit-events", response_model=AuditEventsResponse)
@limiter.limit("120/minute")
async def list_audit_events(
    request: Request,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(
        None,
        description="Return events with id strictly less than this value (pagination for older rows).",
    ),
) -> AuditEventsResponse:
    stmt = select(AuditEvent)
    if before_id is not None:
        stmt = stmt.where(AuditEvent.id < before_id)
    stmt = stmt.order_by(AuditEvent.id.desc()).limit(limit)
    r = await session.execute(stmt)
    rows = r.scalars().all()
    events: list[AuditEventItem] = []
    for ev in rows:
        events.append(
            AuditEventItem(
                id=ev.id,
                created_at=ev.created_at,
                event_type=ev.event_type,
                actor_api_key_id=ev.actor_api_key_id,
                actor_api_key_name=ev.actor_api_key_name,
                bundle_id=ev.bundle_id,
                bundle_name=ev.bundle_name,
                stack_id=ev.stack_id,
                stack_name=ev.stack_name,
                bundle_env_link_id=ev.bundle_env_link_id,
                stack_env_link_id=ev.stack_env_link_id,
                token_sha256_prefix=ev.token_sha256_prefix,
                client_ip=ev.client_ip,
                user_agent=ev.user_agent,
                http_method=ev.http_method,
                path=ev.path,
                details=_parse_audit_details(ev.details),
            )
        )
    return AuditEventsResponse(events=events)
