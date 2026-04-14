from contextlib import asynccontextmanager
from pathlib import Path

_SPA_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, Response

from app.api.tfstate.routes import router as tfstate_router
from app.api.v1.router import router as api_v1_router
from app.limiter import limiter
from app.config import Settings, get_settings
from app.db import get_session_factory, init_db, reset_engine
from app.models import ApiKey
from app.auth_keys import hash_api_key
from app.web.routes import router as web_router


async def _no_store_html_middleware(request: Request, call_next) -> Response:
    """Avoid stale HTML when a reverse proxy caches full pages (CSS may still update)."""
    response = await call_next(request)
    if request.method != "GET":
        return response
    path = request.url.path
    if path.startswith("/app/") or path.startswith("/api/"):
        return response
    ct = response.headers.get("content-type", "")
    if "text/html" in ct:
        response.headers["Cache-Control"] = "private, no-cache, must-revalidate"
    return response


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
    await reset_engine()


def _register_react_spa(app: FastAPI) -> None:
    """Serve the Vite build: real files from dist, everything else → index.html (client-side routes)."""
    dist = _SPA_DIST
    index = dist / "index.html"
    if not dist.is_dir() or not index.is_file():
        return
    root = dist.resolve()

    def _safe_file(rel: str) -> Path | None:
        if rel.startswith(("/", "\\")) or ".." in Path(rel).parts:
            return None
        candidate = (dist / rel).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    @app.get("/app")
    @app.get("/app/")
    async def react_spa_shell() -> FileResponse:
        return FileResponse(index)

    @app.get("/app/{full_path:path}")
    async def react_spa_or_asset(full_path: str) -> FileResponse:
        hit = _safe_file(full_path)
        if hit is not None:
            return FileResponse(hit)
        return FileResponse(index)


def create_app() -> FastAPI:
    settings = get_settings()
    _validate_master_key(settings)
    if not settings.session_secret and not settings.debug:
        raise RuntimeError("ENVELOPE_SESSION_SECRET is required when ENVELOPE_DEBUG is false")
    session_secret = settings.session_secret or "dev-insecure-change-me"

    app = FastAPI(
        title="Envelope",
        description="Self-hosted secure environment bundle manager",
        lifespan=lifespan,
        root_path=settings.root_path or "",
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(
        SessionMiddleware,
        secret_key=session_secret,
        https_only=settings.https_cookies,
    )
    app.middleware("http")(_no_store_html_middleware)

    app.include_router(web_router)
    app.include_router(api_v1_router, prefix="/api/v1")
    if settings.pulumi_state_enabled:
        app.include_router(tfstate_router, prefix="/tfstate")

    _register_react_spa(app)
    return app


app = create_app()
