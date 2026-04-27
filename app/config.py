from functools import lru_cache
import os
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="ENVELOPE_",
        extra="ignore",
    )

    master_key: str = ""  # Fernet key, url-safe base64
    database_url: str = "sqlite+aiosqlite:///./data/envelope.db"
    session_secret: str = ""
    initial_admin_key: str | None = None  # one-time bootstrap if DB has no keys
    debug: bool = False
    backup_enabled: bool = True
    restore_enabled: bool = False  # opt-in: POST restore replaces the SQLite file
    # Public URL path prefix when behind a reverse proxy (e.g. "/envelope"). Match gateway strip + uvicorn --root-path.
    root_path: str = ""
    # Set true when users use HTTPS so session cookies get the Secure flag (TLS terminated at the gateway).
    https_cookies: bool = False
    # Response headers: nosniff, frame denial, Referrer-Policy, Permissions-Policy; optional CSP / HSTS (see docs).
    security_headers_enabled: bool = True
    # Content-Security-Policy: empty = default policy on routes outside /docs, /redoc, /openapi.json; "-" disables CSP.
    security_csp: str = ""
    # Terraform HTTP remote state API (/tfstate/projects/...). See docs/terraform-http-remote-state.md
    terraform_http_state_enabled: bool = True
    # Model Context Protocol endpoint (/mcp). Uses API-key Bearer auth and per-tool scope checks.
    mcp_enabled: bool = True

    # OIDC (browser admin only). Used when no `oidc_app_settings` row exists; otherwise DB wins.
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_allowed_email_domains: str = ""
    oidc_post_login_path: str = "/projects"
    oidc_redirect_uri_override: str = ""

    # Structured security audit: JSON lines via logger `envelope.audit` + optional `audit_events` table.
    audit_log_enabled: bool = True
    audit_database_enabled: bool = True

    @field_validator("root_path", mode="before")
    @classmethod
    def _normalize_root_path(cls, v: object) -> str:
        if v is None or v == "":
            return ""
        s = str(v).strip()
        if not s.startswith("/"):
            s = "/" + s
        return s.rstrip("/")

    @model_validator(mode="before")
    @classmethod
    def _legacy_pulumi_state_env(cls, data: Any) -> Any:
        """Accept ENVELOPE_PULUMI_STATE_ENABLED when ENVELOPE_TERRAFORM_HTTP_STATE_ENABLED is unset."""
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        if os.environ.get("ENVELOPE_TERRAFORM_HTTP_STATE_ENABLED") is None:
            leg = os.environ.get("ENVELOPE_PULUMI_STATE_ENABLED")
            if leg is not None:
                merged["terraform_http_state_enabled"] = leg.lower() in ("1", "true", "yes")
        return merged


@lru_cache
def get_settings() -> Settings:
    return Settings()
