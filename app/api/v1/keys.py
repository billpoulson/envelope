from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_admin
from app.models import ApiKey, OidcIdentity
from app.auth_keys import generate_raw_api_key, hash_api_key
from app.services.scopes import parse_scopes_json, scopes_to_json, validate_scopes_list

router = APIRouter()


class ApiKeyOut(BaseModel):
    id: int
    name: str
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None
    oidc_linked: bool = False


class CreateApiKeyBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    scopes: list[str] = Field(
        default_factory=lambda: ["read:bundle:*"],
        description='e.g. ["admin"] or ["read:bundle:*","read:project:prod-*"]',
    )


class CreateApiKeyResponse(BaseModel):
    id: int
    name: str
    scopes: list[str]
    plain_key: str


@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_api_keys(
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
        )
        for x in rows
    ]


@router.post("/api-keys", status_code=201)
async def create_api_key(
    body: CreateApiKeyBody,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> CreateApiKeyResponse:
    validate_scopes_list(body.scopes)
    plain = generate_raw_api_key()
    row = ApiKey(
        name=body.name.strip(),
        key_hash=hash_api_key(plain),
        scopes=scopes_to_json(body.scopes),
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
async def revoke_api_key(
    key_id: int,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> None:
    await session.execute(delete(OidcIdentity).where(OidcIdentity.api_key_id == key_id))
    r = await session.execute(delete(ApiKey).where(ApiKey.id == key_id))
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="API key not found")
    await session.commit()
