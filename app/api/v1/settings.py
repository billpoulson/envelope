"""App-wide settings (OIDC) — admin only."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_fernet, require_admin
from app.models import ApiKey, OidcAppSettings
from app.services.oidc_config import (
    EffectiveOidcConfig,
    encrypt_oidc_secret,
    load_effective_oidc_config,
    oidc_callback_redirect_uri,
)
from app.services.scopes import parse_scopes_json, scopes_allow_admin

router = APIRouter(prefix="/settings", tags=["settings"])


class OidcSettingsResponse(BaseModel):
    source: Literal["db", "env"]
    enabled: bool
    issuer: str
    client_id: str
    client_secret_configured: bool
    scopes: str
    allowed_email_domains: str
    post_login_path: str
    proxy_admin_key_id: int | None
    redirect_uri_override: str | None
    oidc_login_ready: bool
    suggested_callback_url: str


class OidcSettingsPatch(BaseModel):
    enabled: bool | None = None
    issuer: str | None = None
    client_id: str | None = None
    client_secret: str | None = Field(
        default=None,
        description="Set to update secret; omit to leave unchanged; empty string clears stored secret.",
    )
    scopes: str | None = None
    allowed_email_domains: str | None = None
    post_login_path: str | None = None
    proxy_admin_key_id: int | None = None
    redirect_uri_override: str | None = None


def _effective_to_public(
    cfg: EffectiveOidcConfig,
    secret_configured: bool,
    *,
    suggested_callback_url: str,
) -> OidcSettingsResponse:
    domains = ",".join(cfg.allowed_email_domains) if cfg.allowed_email_domains else ""
    return OidcSettingsResponse(
        source=cfg.source if cfg.source in ("db", "env") else "env",
        enabled=cfg.enabled,
        issuer=cfg.issuer,
        client_id=cfg.client_id,
        client_secret_configured=secret_configured,
        scopes=cfg.scopes,
        allowed_email_domains=domains,
        post_login_path=cfg.post_login_path,
        proxy_admin_key_id=cfg.proxy_admin_key_id,
        redirect_uri_override=cfg.redirect_uri_override,
        oidc_login_ready=cfg.is_login_ready(),
        suggested_callback_url=suggested_callback_url,
    )


@router.get("/oidc", response_model=OidcSettingsResponse)
async def get_oidc_settings(
    request: Request,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> OidcSettingsResponse:
    cfg = await load_effective_oidc_config(session)
    sug = oidc_callback_redirect_uri(request, cfg)
    return _effective_to_public(cfg, bool(cfg.client_secret), suggested_callback_url=sug)


@router.patch("/oidc", response_model=OidcSettingsResponse)
async def patch_oidc_settings(
    request: Request,
    body: OidcSettingsPatch,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> OidcSettingsResponse:
    r = await session.execute(select(OidcAppSettings).where(OidcAppSettings.id == 1))
    row = r.scalar_one_or_none()
    if row is None:
        row = OidcAppSettings(id=1)
        session.add(row)

    data = body.model_dump(exclude_unset=True)
    fernet = get_fernet()

    if "enabled" in data:
        row.enabled = bool(data["enabled"])
    if "issuer" in data and data["issuer"] is not None:
        row.issuer = str(data["issuer"]).strip() or None
    if "client_id" in data and data["client_id"] is not None:
        row.client_id = str(data["client_id"]).strip() or None
    if "client_secret" in data:
        cs = data["client_secret"]
        if cs is None:
            pass
        elif str(cs).strip() == "":
            row.client_secret_encrypted = None
        else:
            row.client_secret_encrypted = encrypt_oidc_secret(fernet, str(cs))
    if "scopes" in data and data["scopes"] is not None:
        row.scopes = str(data["scopes"]).strip() or "openid email profile"
    if "allowed_email_domains" in data:
        v = data["allowed_email_domains"]
        row.allowed_email_domains = None if v is None else str(v)
    if "post_login_path" in data and data["post_login_path"] is not None:
        p = str(data["post_login_path"]).strip()
        row.post_login_path = p or "/projects"
    if "proxy_admin_key_id" in data:
        kid = data["proxy_admin_key_id"]
        if kid is None:
            row.proxy_admin_key_id = None
        else:
            kr = await session.execute(select(ApiKey).where(ApiKey.id == int(kid)))
            key_row = kr.scalar_one_or_none()
            if key_row is None:
                raise HTTPException(status_code=400, detail="proxy_admin_key_id does not exist")
            if not scopes_allow_admin(parse_scopes_json(key_row.scopes)):
                raise HTTPException(status_code=400, detail="proxy API key must have admin scope")
            row.proxy_admin_key_id = int(kid)
    if "redirect_uri_override" in data:
        v = data["redirect_uri_override"]
        row.redirect_uri_override = None if v is None else (str(v).strip() or None)

    await session.commit()
    await session.refresh(row)

    cfg = await load_effective_oidc_config(session)
    secret_cfg = bool(cfg.client_secret)
    sug = oidc_callback_redirect_uri(request, cfg)
    return _effective_to_public(cfg, secret_cfg, suggested_callback_url=sug)
