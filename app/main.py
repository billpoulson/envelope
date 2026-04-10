from contextlib import asynccontextmanager

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.api.tfstate.routes import router as tfstate_router
from app.api.v1.router import router as api_v1_router
from app.limiter import limiter
from app.config import Settings, get_settings
from app.db import get_session_factory, init_db
from app.models import ApiKey
from app.auth_keys import hash_api_key
from app.paths import url_path
from app.web.routes import router as web_router, templates


def _validate_master_key(settings: Settings) -> None:
    if not settings.master_key or not settings.master_key.strip():
        raise RuntimeError(
            "ENVELOPE_MASTER_KEY is required (Fernet key, url-safe base64). "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    try:
        Fernet(settings.master_key.strip().encode("ascii"))
    except (InvalidToken, ValueError) as e:
        raise RuntimeError("ENVELOPE_MASTER_KEY must be a valid Fernet key") from e


async def _bootstrap_admin_if_needed(session: AsyncSession, settings: Settings) -> None:
    r = await session.execute(select(ApiKey.id).limit(1))
    if r.scalar_one_or_none() is not None:
        return
    raw = settings.initial_admin_key
    if not raw or not raw.strip():
        raise RuntimeError(
            "No API keys in database. Set ENVELOPE_INITIAL_ADMIN_KEY once to create the first admin key, "
            "then remove it from the environment and rotate."
        )
    raw = raw.strip()
    row = ApiKey(
        name="bootstrap",
        key_hash=hash_api_key(raw),
        scopes='["admin"]',
    )
    session.add(row)
    await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    factory = get_session_factory()
    async with factory() as session:
        settings = get_settings()
        await _bootstrap_admin_if_needed(session, settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    _validate_master_key(settings)
    if not settings.session_secret and not settings.debug:
        raise RuntimeError("ENVELOPE_SESSION_SECRET is required when ENVELOPE_DEBUG is false")
    session_secret = settings.session_secret or "dev-insecure-change-me"

    root = settings.root_path or ""
    templates.env.globals["url_path"] = url_path

    app = FastAPI(
        title="Envelope",
        description="Self-hosted secure environment bundle manager",
        lifespan=lifespan,
        root_path=root,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(
        SessionMiddleware,
        secret_key=session_secret,
        https_only=settings.https_cookies,
    )

    app.include_router(web_router)
    app.include_router(api_v1_router, prefix="/api/v1")
    if settings.pulumi_state_enabled:
        app.include_router(tfstate_router, prefix="/tfstate")

    app.mount("/static", StaticFiles(directory="static"), name="static")
    return app


app = create_app()
