from functools import lru_cache

from pydantic import field_validator
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
    # Terraform HTTP remote state API (/tfstate/...). See docs/terraform-http-remote-state.md
    pulumi_state_enabled: bool = True

    # OIDC (browser admin only). Used when no `oidc_app_settings` row exists; otherwise DB wins.
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_allowed_email_domains: str = ""
    oidc_post_login_path: str = "/projects"
    oidc_redirect_uri_override: str = ""

    @field_validator("root_path", mode="before")
    @classmethod
    def _normalize_root_path(cls, v: object) -> str:
        if v is None or v == "":
            return ""
        s = str(v).strip()
        if not s.startswith("/"):
            s = "/" + s
        return s.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
