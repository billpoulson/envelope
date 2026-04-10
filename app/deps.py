from functools import lru_cache
from typing import Annotated

from cryptography.fernet import Fernet
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import ApiKey
from app.auth_keys import verify_api_key
from app.services.scopes import parse_scopes_json, scopes_allow_admin


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
    from datetime import datetime, timezone

    result = await session.execute(select(ApiKey))
    rows = result.scalars().all()
    for row in rows:
        if verify_api_key(token, row.key_hash):
            if row.expires_at and row.expires_at < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="API key expired")
            return row
    raise HTTPException(status_code=401, detail="Invalid API key")


async def get_api_key(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_db),
) -> ApiKey:
    token = await get_bearer_token(authorization)
    return await resolve_api_key(token, session)


async def require_admin(key: ApiKey = Depends(get_api_key)) -> ApiKey:
    if not scopes_allow_admin(parse_scopes_json(key.scopes)):
        raise HTTPException(status_code=403, detail="Admin scope required")
    return key
