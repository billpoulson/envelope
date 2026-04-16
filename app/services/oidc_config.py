"""Effective OIDC configuration: DB row id=1 when present, else environment defaults."""

from __future__ import annotations

from dataclasses import dataclass

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.config import Settings, get_settings
from app.deps import get_fernet
from app.models import OidcAppSettings


@dataclass(frozen=True)
class EffectiveOidcConfig:
    enabled: bool
    issuer: str
    client_id: str
    client_secret: str | None
    scopes: str
    allowed_email_domains: list[str]
    post_login_path: str
    proxy_admin_key_id: int | None
    redirect_uri_override: str | None
    source: str  # "db" | "env"

    def is_login_ready(self) -> bool:
        if not self.enabled:
            return False
        if not self.issuer or not self.client_id:
            return False
        if not self.client_secret:
            return False
        if self.proxy_admin_key_id is None:
            return False
        return True


def _parse_domains(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [
        d.strip().lower().lstrip("@")
        for d in str(raw).split(",")
        if d.strip()
    ]


def encrypt_oidc_secret(fernet: Fernet, plain: str | None) -> bytes | None:
    if not plain or not str(plain).strip():
        return None
    return fernet.encrypt(str(plain).strip().encode("utf-8"))


def decrypt_oidc_secret(fernet: Fernet, blob: bytes | None) -> str | None:
    if not blob:
        return None
    return fernet.decrypt(blob).decode("utf-8")


def _from_env(settings: Settings) -> EffectiveOidcConfig:
    secret = (settings.oidc_client_secret or "").strip() or None
    return EffectiveOidcConfig(
        enabled=bool(settings.oidc_enabled),
        issuer=(settings.oidc_issuer or "").strip(),
        client_id=(settings.oidc_client_id or "").strip(),
        client_secret=secret,
        scopes=(settings.oidc_scopes or "").strip() or "openid email profile",
        allowed_email_domains=_parse_domains(settings.oidc_allowed_email_domains),
        post_login_path=(settings.oidc_post_login_path or "").strip() or "/projects",
        proxy_admin_key_id=settings.oidc_proxy_admin_key_id,
        redirect_uri_override=(settings.oidc_redirect_uri_override or "").strip() or None,
        source="env",
    )


async def load_effective_oidc_config(session: AsyncSession) -> EffectiveOidcConfig:
    r = await session.execute(select(OidcAppSettings).where(OidcAppSettings.id == 1))
    row = r.scalar_one_or_none()
    settings = get_settings()
    fernet = get_fernet()
    if row is None:
        return _from_env(settings)
    secret = decrypt_oidc_secret(fernet, row.client_secret_encrypted)
    return EffectiveOidcConfig(
        enabled=bool(row.enabled),
        issuer=(row.issuer or "").strip(),
        client_id=(row.client_id or "").strip(),
        client_secret=secret,
        scopes=(row.scopes or "").strip() or "openid email profile",
        allowed_email_domains=_parse_domains(row.allowed_email_domains),
        post_login_path=(row.post_login_path or "").strip() or "/projects",
        proxy_admin_key_id=row.proxy_admin_key_id,
        redirect_uri_override=(row.redirect_uri_override or "").strip() or None,
        source="db",
    )


def oidc_callback_redirect_uri(request: Request, cfg: EffectiveOidcConfig) -> str:
    """Must match the value used in the authorize request and token exchange."""
    if cfg.redirect_uri_override:
        return cfg.redirect_uri_override.rstrip("/")
    root = (request.scope.get("root_path") or "").rstrip("/")
    base = str(request.base_url).rstrip("/")
    return f"{base}{root}/api/v1/auth/oidc/callback"


def email_allowed_for_oidc(email: str | None, domains: list[str]) -> bool:
    if not domains:
        return True
    if not email or not str(email).strip():
        return False
    e = str(email).lower().strip()
    parts = e.split("@", 1)
    if len(parts) != 2:
        return False
    domain = parts[1]
    for d in domains:
        if domain == d or domain.endswith("." + d):
            return True
    return False
