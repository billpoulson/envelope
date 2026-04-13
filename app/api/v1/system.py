"""Admin-only disaster recovery: full SQLite backup and optional restore."""

from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import get_bearer_token, require_admin, resolve_api_key
from app.limiter import limiter
from app.models import ApiKey
from app.services.scopes import parse_scopes_json, scopes_allow_admin
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


def _backup_filename(prefix: str = "envelope") -> str:
    d = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}-{d}.db"


@router.get("/backup/database")
@limiter.limit("60/hour")
async def download_database_backup(
    request: Request,
    _: ApiKey = Depends(require_admin),
) -> Response:
    settings = get_settings()
    if not settings.backup_enabled:
        raise HTTPException(status_code=403, detail="Backup API is disabled")
    if database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(
            status_code=400,
            detail="Backup is only available for file-backed SQLite databases",
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
    _: ApiKey = Depends(require_admin),
) -> Response:
    settings = get_settings()
    if not settings.backup_enabled:
        raise HTTPException(status_code=403, detail="Backup API is disabled")
    if database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(
            status_code=400,
            detail="Backup is only available for file-backed SQLite databases",
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
    # Read Authorization from the request (Header() injection is unreliable for multipart bodies).
    token = await get_bearer_token(request.headers.get("Authorization"))
    key = await resolve_api_key(token, session)
    if not scopes_allow_admin(parse_scopes_json(key.scopes)):
        raise HTTPException(status_code=403, detail="Admin scope required")
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
    return {"status": "ok", "message": "Database restored; new connections use the replaced file."}
