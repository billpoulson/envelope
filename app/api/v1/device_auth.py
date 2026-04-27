"""OAuth2-style device authorization for the Envelope CLI (browser approval → API key)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.auth_keys import (
    device_code_lookup_hmac,
    generate_raw_api_key,
    hash_api_key,
    key_lookup_hmac,
)
from app.config import get_settings
from app.db import get_db
from app.deps import get_fernet, require_admin
from app.limiter import CLI_DEVICE_AUTHORIZE, CLI_DEVICE_TOKEN, limiter
from app.models import ApiKey, CliDeviceAuthorization
from app.paths import url_path
from app.services.audit import emit_audit_event
from app.services.scopes import scopes_to_json, validate_scopes_list
router = APIRouter()

_USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_DEVICE_TTL_SEC = 900
_DEFAULT_INTERVAL = 5


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _generate_user_code() -> str:
    part = "".join(secrets.choice(_USER_CODE_ALPHABET) for _ in range(8))
    return f"{part[:4]}-{part[4:]}"


def _public_base(request: Request) -> str:
    root = (request.scope.get("root_path") or "").rstrip("/")
    return str(request.base_url).rstrip("/") + root


class DeviceAuthorizationResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class DeviceTokenRequest(BaseModel):
    grant_type: str
    device_code: str = Field(..., min_length=10)


class DeviceApproveBody(BaseModel):
    user_code: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=128)
    scopes: list[str] = Field(
        default_factory=lambda: ["read:bundle:*"],
    )
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def expires_at_future_aware(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            raise ValueError("expires_at must be timezone-aware")
        if v.astimezone(timezone.utc) <= _utcnow():
            raise ValueError("expires_at must be in the future")
        return v


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_user_code(raw: str) -> str:
    s = raw.strip().upper().replace(" ", "")
    if len(s) == 8 and "-" not in s:
        return f"{s[:4]}-{s[4:]}"
    return s


@router.post("/auth/device", response_model=DeviceAuthorizationResponse)
@limiter.limit(CLI_DEVICE_AUTHORIZE)
async def device_authorize(request: Request, session: AsyncSession = Depends(get_db)) -> DeviceAuthorizationResponse:
    settings = get_settings()
    base = _public_base(request)
    verify_path = url_path("/cli/device")
    verify_url = f"{base}{verify_path}"

    for _ in range(8):
        user_code = _generate_user_code()
        device_code = secrets.token_urlsafe(48)
        hmac_d = device_code_lookup_hmac(device_code, settings.master_key)
        now = _utcnow()
        expires = now + timedelta(seconds=_DEVICE_TTL_SEC)
        r_dup = await session.execute(
            select(CliDeviceAuthorization.id).where(
                CliDeviceAuthorization.user_code == user_code,
                CliDeviceAuthorization.status == "pending",
                CliDeviceAuthorization.expires_at > now,
            )
        )
        if r_dup.scalar_one_or_none() is not None:
            continue
        row = CliDeviceAuthorization(
            user_code=user_code,
            device_code_hmac=hmac_d,
            expires_at=expires,
            status="pending",
            poll_interval_sec=_DEFAULT_INTERVAL,
        )
        session.add(row)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            continue
        qc = quote(user_code, safe="")
        return DeviceAuthorizationResponse(
            device_code=device_code,
            user_code=user_code,
            verification_uri=verify_url,
            verification_uri_complete=f"{verify_url}?code={qc}",
            expires_in=_DEVICE_TTL_SEC,
            interval=_DEFAULT_INTERVAL,
        )
    raise HTTPException(status_code=500, detail="Could not allocate device session")


@router.post("/auth/device/token")
@limiter.limit(CLI_DEVICE_TOKEN)
async def device_token(
    request: Request,
    body: DeviceTokenRequest,
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.grant_type != "urn:ietf:params:oauth:grant-type:device_code":
        raise HTTPException(status_code=400, detail="unsupported_grant_type")
    settings = get_settings()
    hmac_d = device_code_lookup_hmac(body.device_code.strip(), settings.master_key)
    r = await session.execute(
        select(CliDeviceAuthorization).where(CliDeviceAuthorization.device_code_hmac == hmac_d)
    )
    row = r.scalar_one_or_none()
    if row is None:
        return {"error": "invalid_grant"}

    now = _utcnow()
    if _as_utc(row.expires_at) < now:
        row.status = "expired"
        await session.commit()
        return {"error": "expired_token"}

    if row.status == "consumed":
        return {"error": "invalid_grant"}

    if row.status == "denied":
        return {"error": "access_denied"}

    if row.last_poll_at is not None:
        delta = (now - _as_utc(row.last_poll_at)).total_seconds()
        if delta < row.poll_interval_sec:
            return {"error": "slow_down"}

    row.last_poll_at = now
    await session.commit()

    if row.status == "pending":
        return {"error": "authorization_pending"}

    if row.status != "approved":
        return {"error": "invalid_grant"}

    blob = row.encrypted_grant
    if not blob:
        return {"error": "invalid_grant"}

    fernet = get_fernet()
    try:
        plain = fernet.decrypt(blob).decode("utf-8")
    except InvalidToken:
        return {"error": "invalid_grant"}

    row.encrypted_grant = None
    row.status = "consumed"
    await session.commit()

    return {"access_token": plain, "token_type": "Bearer"}


@router.post("/auth/device/approve")
async def device_approve(
    request: Request,
    body: DeviceApproveBody,
    admin_key: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    uc = _normalize_user_code(body.user_code)
    now = _utcnow()
    r = await session.execute(
        select(CliDeviceAuthorization).where(
            CliDeviceAuthorization.user_code == uc,
            CliDeviceAuthorization.status == "pending",
        )
    )
    row = r.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No pending authorization for this code")

    if _as_utc(row.expires_at) < now:
        row.status = "expired"
        await session.commit()
        raise HTTPException(status_code=400, detail="This authorization request has expired")

    validate_scopes_list(body.scopes)
    plain = generate_raw_api_key()
    settings = get_settings()
    key_row = ApiKey(
        name=body.name.strip(),
        key_hash=hash_api_key(plain),
        key_lookup_hmac=key_lookup_hmac(plain, settings.master_key),
        scopes=scopes_to_json(body.scopes),
        expires_at=body.expires_at,
    )
    session.add(key_row)
    await session.flush()

    fernet = get_fernet()
    row.encrypted_grant = fernet.encrypt(plain.encode("utf-8"))
    row.status = "approved"
    row.created_api_key_id = key_row.id
    row.approver_admin_key_id = admin_key.id
    await session.commit()

    await emit_audit_event(
        session,
        request,
        event_type="cli_device.approve",
        actor=admin_key,
        details={
            "cli_device_authorization_id": row.id,
            "created_api_key_id": key_row.id,
            "user_code_prefix": uc[:2],
        },
    )
    return {"status": "ok"}
