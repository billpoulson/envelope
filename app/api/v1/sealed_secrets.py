from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key
from app.models import ApiKey, Bundle, Certificate, SealedSecret, SealedSecretRecipient
from app.services.bundles import normalize_env_key, validate_bundle_name
from app.services.scopes import can_read_bundle, can_write_bundle, parse_scopes_json

router = APIRouter()


class WrappedRecipientBody(BaseModel):
    certificate_id: int = Field(..., ge=1)
    wrapped_key: str = Field(..., min_length=1, max_length=65535)
    key_wrap_alg: str = Field(default="rsa-oaep-256", min_length=1, max_length=64)


class UpsertSealedSecretBody(BaseModel):
    key_name: str = Field(..., min_length=1, max_length=512)
    enc_alg: str = Field(default="aes-256-gcm", min_length=1, max_length=64)
    payload_ciphertext: str = Field(..., min_length=1, max_length=1048576)
    payload_nonce: str = Field(..., min_length=1, max_length=512)
    payload_aad: str | None = Field(default=None, max_length=65535)
    recipients: list[WrappedRecipientBody] = Field(..., min_length=1)


class SealedSecretRecipientOut(BaseModel):
    certificate_id: int
    wrapped_key: str
    key_wrap_alg: str


class SealedSecretOut(BaseModel):
    key_name: str
    enc_alg: str
    payload_ciphertext: str
    payload_nonce: str
    payload_aad: str | None
    recipients: list[SealedSecretRecipientOut]
    updated_at: datetime


def _bundle_project_name_slug(bundle: Bundle) -> tuple[str | None, str | None]:
    pname = bundle.group.name if bundle.group else None
    pslug = bundle.group.slug if bundle.group else None
    return pname, pslug


async def _get_bundle_or_404(session: AsyncSession, name: str) -> Bundle:
    validate_bundle_name(name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(selectinload(Bundle.group))
    )
    bundle = r.scalar_one_or_none()
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return bundle


@router.get("/bundles/{name}/sealed-secrets", response_model=list[SealedSecretOut])
async def list_sealed_secrets(
    name: str,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[SealedSecretOut]:
    bundle = await _get_bundle_or_404(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pname, pslug = _bundle_project_name_slug(bundle)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    r = await session.execute(
        select(SealedSecret)
        .where(SealedSecret.bundle_id == bundle.id)
        .options(selectinload(SealedSecret.recipients))
        .order_by(SealedSecret.key_name)
    )
    rows = r.scalars().all()
    return [
        SealedSecretOut(
            key_name=row.key_name,
            enc_alg=row.enc_alg,
            payload_ciphertext=row.payload_ciphertext,
            payload_nonce=row.payload_nonce,
            payload_aad=row.payload_aad,
            recipients=[
                SealedSecretRecipientOut(
                    certificate_id=rec.certificate_id,
                    wrapped_key=rec.wrapped_key,
                    key_wrap_alg=rec.key_wrap_alg,
                )
                for rec in sorted(row.recipients, key=lambda x: x.certificate_id)
            ],
            updated_at=row.updated_at,
        )
        for row in rows
    ]


@router.post("/bundles/{name}/sealed-secrets", status_code=204)
async def upsert_sealed_secret(
    name: str,
    body: UpsertSealedSecretBody,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> None:
    bundle = await _get_bundle_or_404(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pname, pslug = _bundle_project_name_slug(bundle)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    key_name = normalize_env_key(body.key_name)
    if not key_name:
        raise HTTPException(status_code=400, detail="key_name required")
    deduped_recipients: dict[int, WrappedRecipientBody] = {}
    for rec in body.recipients:
        deduped_recipients[rec.certificate_id] = rec
    cert_ids = sorted(deduped_recipients.keys())
    if not cert_ids:
        raise HTTPException(status_code=400, detail="At least one recipient is required")
    cert_rows = await session.execute(
        select(Certificate.id).where(Certificate.id.in_(cert_ids))
    )
    existing_cert_ids = {row[0] for row in cert_rows.all()}
    missing = [cid for cid in cert_ids if cid not in existing_cert_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown certificate ids: {', '.join(str(x) for x in missing)}",
        )
    r = await session.execute(
        select(SealedSecret)
        .where(SealedSecret.bundle_id == bundle.id, SealedSecret.key_name == key_name)
        .options(selectinload(SealedSecret.recipients))
    )
    row = r.scalar_one_or_none()
    if row is None:
        row = SealedSecret(
            bundle_id=bundle.id,
            key_name=key_name,
            enc_alg=body.enc_alg.strip(),
            payload_ciphertext=body.payload_ciphertext.strip(),
            payload_nonce=body.payload_nonce.strip(),
            payload_aad=body.payload_aad,
        )
        session.add(row)
        await session.flush()
    else:
        row.enc_alg = body.enc_alg.strip()
        row.payload_ciphertext = body.payload_ciphertext.strip()
        row.payload_nonce = body.payload_nonce.strip()
        row.payload_aad = body.payload_aad
        await session.execute(
            delete(SealedSecretRecipient).where(SealedSecretRecipient.sealed_secret_id == row.id)
        )
    for rec in deduped_recipients.values():
        session.add(
            SealedSecretRecipient(
                sealed_secret_id=row.id,
                certificate_id=rec.certificate_id,
                wrapped_key=rec.wrapped_key.strip(),
                key_wrap_alg=rec.key_wrap_alg.strip(),
            )
        )
    await session.commit()


@router.delete("/bundles/{name}/sealed-secrets")
async def delete_sealed_secret(
    name: str,
    key_name: str,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    bundle = await _get_bundle_or_404(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pname, pslug = _bundle_project_name_slug(bundle)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    key_name = normalize_env_key(key_name)
    if not key_name:
        raise HTTPException(status_code=400, detail="key_name required")
    r = await session.execute(
        delete(SealedSecret).where(
            SealedSecret.bundle_id == bundle.id,
            SealedSecret.key_name == key_name,
        )
    )
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Sealed secret not found")
    await session.commit()
    return {"status": "ok"}
