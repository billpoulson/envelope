import base64
from functools import lru_cache
from typing import Annotated

from cryptography.fernet import Fernet
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException
from starlette.requests import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import ApiKey
from app.auth_keys import key_lookup_hmac, verify_api_key
from app.services.scopes import parse_scopes_json, scopes_allow_admin, scopes_allow_terraform_http_state


@lru_cache
def get_fernet() -> Fernet:
    settings = get_settings()
    return Fernet(settings.master_key.strip().encode("ascii"))


async def get_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing API key")
    return token


async def resolve_api_key(
    token: str,
    session: AsyncSession,
) -> ApiKey:
    settings = get_settings()
    lookup = key_lookup_hmac(token, settings.master_key)
    r = await session.execute(select(ApiKey).where(ApiKey.key_lookup_hmac == lookup))
    row = r.scalar_one_or_none()
    if row is not None:
        if row.expires_at and row.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="API key expired")
        if not verify_api_key(token, row.key_hash):
            raise HTTPException(status_code=401, detail="Invalid API key")
        return row

    r_legacy = await session.execute(select(ApiKey).where(ApiKey.key_lookup_hmac.is_(None)))
    for legacy_row in r_legacy.scalars().all():
        if verify_api_key(token, legacy_row.key_hash):
            if legacy_row.expires_at and legacy_row.expires_at < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="API key expired")
            return legacy_row
    raise HTTPException(status_code=401, detail="Invalid API key")


def _bearer_token_optional(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    t = authorization[7:].strip()
    return t if t else None


async def get_api_key(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_db),
) -> ApiKey:
    """Resolve API key from Bearer header, or from browser session (`admin_key_id`) after web/JSON login."""
    token = _bearer_token_optional(authorization)
    if token:
        return await resolve_api_key(token, session)
    raw_id = request.session.get("admin_key_id")
    if raw_id is not None:
        try:
            kid = int(raw_id)
        except (TypeError, ValueError):
            kid = None
        if kid is not None:
            r = await session.execute(select(ApiKey).where(ApiKey.id == kid))
            row = r.scalar_one_or_none()
            if row is not None:
                if row.expires_at and row.expires_at < datetime.now(timezone.utc):
                    raise HTTPException(status_code=401, detail="API key expired")
                if scopes_allow_admin(parse_scopes_json(row.scopes)):
                    return row
    raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")


async def require_admin(key: ApiKey = Depends(get_api_key)) -> ApiKey:
    if not scopes_allow_admin(parse_scopes_json(key.scopes)):
        raise HTTPException(status_code=403, detail="Admin scope required")
    return key


def _parse_basic_credentials(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        raw = base64.b64decode(authorization[6:].strip(), validate=True).decode("utf-8")
    except Exception:
        return None
    if ":" not in raw:
        return None
    _user, pw = raw.split(":", 1)
    return pw if pw else None


async def resolve_api_key_bearer_or_basic(
    authorization: str | None,
    session: AsyncSession,
) -> ApiKey:
    """Same auth as Terraform HTTP backend: Bearer or Basic (password = API key)."""
    token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif authorization:
        token = _parse_basic_credentials(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization (Bearer or Basic)")
    return await resolve_api_key(token, session)


async def get_api_key_bearer_or_basic(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_db),
) -> ApiKey:
    return await resolve_api_key_bearer_or_basic(authorization, session)


async def get_api_key_for_tfstate_http(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_db),
) -> ApiKey:
    """Legacy /tfstate/blobs/… only: requires terraform:http_state, pulumi:state, or admin."""
    key = await resolve_api_key_bearer_or_basic(authorization, session)
    if not scopes_allow_terraform_http_state(parse_scopes_json(key.scopes)):
        raise HTTPException(
            status_code=403,
            detail="terraform:http_state or admin scope required (legacy: pulumi:state)",
        )
    return key
