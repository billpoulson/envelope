from datetime import datetime

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from fastapi import APIRouter, Depends, HTTPException
from starlette.requests import Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_admin
from app.limiter import CERTIFICATES_LIST, CERTIFICATES_WRITE, limiter
from app.models import ApiKey, Certificate

router = APIRouter()


class CertificateOut(BaseModel):
    id: int
    name: str
    fingerprint_sha256: str
    created_at: datetime


class CreateCertificateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    certificate_pem: str = Field(..., min_length=1, max_length=65535)


def _certificate_fingerprint_sha256_hex(certificate_pem: str) -> str:
    try:
        cert = x509.load_pem_x509_certificate(certificate_pem.encode("utf-8"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid PEM certificate") from e
    return cert.fingerprint(hashes.SHA256()).hex()


@router.get("/certificates", response_model=list[CertificateOut])
@limiter.limit(CERTIFICATES_LIST)
async def list_certificates(
    request: Request,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> list[CertificateOut]:
    r = await session.execute(select(Certificate).order_by(Certificate.id))
    rows = r.scalars().all()
    return [
        CertificateOut(
            id=row.id,
            name=row.name,
            fingerprint_sha256=row.fingerprint_sha256,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/certificates", status_code=201, response_model=CertificateOut)
@limiter.limit(CERTIFICATES_WRITE)
async def create_certificate(
    request: Request,
    body: CreateCertificateBody,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> CertificateOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    fingerprint = _certificate_fingerprint_sha256_hex(body.certificate_pem.strip())
    existing = await session.execute(
        select(Certificate.id).where(
            (Certificate.name == name) | (Certificate.fingerprint_sha256 == fingerprint)
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="Certificate with this name or fingerprint already exists",
        )
    row = Certificate(
        name=name,
        fingerprint_sha256=fingerprint,
        certificate_pem=body.certificate_pem.strip(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return CertificateOut(
        id=row.id,
        name=row.name,
        fingerprint_sha256=row.fingerprint_sha256,
        created_at=row.created_at,
    )


@router.delete("/certificates/{certificate_id}", status_code=204)
@limiter.limit(CERTIFICATES_WRITE)
async def delete_certificate(
    request: Request,
    certificate_id: int,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> None:
    r = await session.execute(delete(Certificate).where(Certificate.id == certificate_id))
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Certificate not found")
    await session.commit()
