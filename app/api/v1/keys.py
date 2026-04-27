from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from starlette.requests import Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_keys import generate_raw_api_key, hash_api_key, key_lookup_hmac
from app.config import get_settings
from app.db import get_db
from app.deps import require_admin
from app.limiter import API_KEYS_CREATE, API_KEYS_DELETE, API_KEYS_LIST, limiter
from app.models import ApiKey, OidcIdentity
from app.services.scopes import parse_scopes_json, scopes_to_json, validate_scopes_list

router = APIRouter()


class ApiKeyOut(BaseModel):
    id: int
    name: str
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None
    oidc_linked: bool = False
    last_accessed_at: datetime | None = None
    last_accessed_usage_name: str | None = None
    last_accessed_usage_kind: str | None = None
    last_accessed_usage_run: str | None = None
    last_accessed_ip: str | None = None
    last_accessed_user_agent: str | None = None


class CreateApiKeyBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    scopes: list[str] = Field(
        default_factory=lambda: ["read:bundle:*"],
        description='e.g. ["admin"] or ["read:bundle:*","read:project:prod-*"]',
    )
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def expires_at_must_be_timezone_aware_and_future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            raise ValueError("expires_at must be timezone-aware (include Z or a UTC offset)")
        now = datetime.now(timezone.utc)
        v_utc = v.astimezone(timezone.utc)
        if v_utc <= now:
            raise ValueError("expires_at must be in the future")
        return v_utc


class CreateApiKeyResponse(BaseModel):
    id: int
    name: str
    scopes: list[str]
    plain_key: str


@router.get("/api-keys", response_model=list[ApiKeyOut])
@limiter.limit(API_KEYS_LIST)
async def list_api_keys(
    request: Request,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> list[ApiKeyOut]:
    r = await session.execute(select(ApiKey).order_by(ApiKey.id))
    rows = r.scalars().all()
    r_oidc = await session.execute(select(OidcIdentity.api_key_id))
    linked_ids = {row[0] for row in r_oidc.all()}
    return [
        ApiKeyOut(
            id=x.id,
            name=x.name,
            scopes=parse_scopes_json(x.scopes),
            created_at=x.created_at,
            expires_at=x.expires_at,
            oidc_linked=x.id in linked_ids,
            last_accessed_at=x.last_accessed_at,
            last_accessed_usage_name=x.last_accessed_usage_name,
            last_accessed_usage_kind=x.last_accessed_usage_kind,
            last_accessed_usage_run=x.last_accessed_usage_run,
            last_accessed_ip=x.last_accessed_ip,
            last_accessed_user_agent=x.last_accessed_user_agent,
        )
        for x in rows
    ]


@router.post("/api-keys", status_code=201)
@limiter.limit(API_KEYS_CREATE)
async def create_api_key(
    request: Request,
    body: CreateApiKeyBody,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> CreateApiKeyResponse:
    validate_scopes_list(body.scopes)
    plain = generate_raw_api_key()
    settings = get_settings()
    row = ApiKey(
        name=body.name.strip(),
        key_hash=hash_api_key(plain),
        key_lookup_hmac=key_lookup_hmac(plain, settings.master_key),
        scopes=scopes_to_json(body.scopes),
        expires_at=body.expires_at,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return CreateApiKeyResponse(
        id=row.id,
        name=row.name,
        scopes=parse_scopes_json(row.scopes),
        plain_key=plain,
    )


@router.delete("/api-keys/{key_id}", status_code=204)
@limiter.limit(API_KEYS_DELETE)
async def revoke_api_key(
    request: Request,
    key_id: int,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> None:
    await session.execute(delete(OidcIdentity).where(OidcIdentity.api_key_id == key_id))
    r = await session.execute(delete(ApiKey).where(ApiKey.id == key_id))
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="API key not found")
    await session.commit()
