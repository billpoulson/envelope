"""Browser routes without Jinja: public env downloads, SPA redirects, legacy path aliases."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse
from starlette.status import HTTP_302_FOUND

from app.db import get_db
from app.limiter import limiter
from app.models import Bundle, BundleEnvLink, BundleStack, StackEnvLink
from app.paths import url_path
from app.services.bundles import format_secrets_dotenv, load_bundle_secrets
from app.services.env_links import token_sha256_hex
from app.services.stacks import get_stack_by_name, load_stack_secrets, load_stack_secrets_through
from app.session_csrf import check_csrf

router = APIRouter()

_LEGACY_SPA_SEGMENTS = (
    "projects",
    "bundles",
    "stacks",
    "help",
    "keys",
    "certificates",
    "backup",
)


def _app(path: str) -> str:
    p = path if path.startswith("/") else "/" + path
    return url_path("/app" + p)


def _register_legacy_spa_redirects() -> None:
    """Old admin lived at /projects, /bundles, … — React lives under /app/…."""
    for seg in _LEGACY_SPA_SEGMENTS:
        root_h = _make_root(seg)
        nested_h = _make_nested(seg)
        router.add_api_route(
            f"/{seg}",
            root_h,
            methods=["GET", "HEAD"],
            name=f"legacy_spa_{seg}_root",
        )
        router.add_api_route(
            f"/{seg}/{{rest:path}}",
            nested_h,
            methods=["GET", "HEAD"],
            name=f"legacy_spa_{seg}_nested",
        )


def _make_root(segment: str):
    async def _h() -> RedirectResponse:
        return RedirectResponse(_app(f"/{segment}"), status_code=HTTP_302_FOUND)

    return _h


def _make_nested(segment: str):
    async def _h(rest: str) -> RedirectResponse:
        return RedirectResponse(_app(f"/{segment}/{rest}"), status_code=HTTP_302_FOUND)

    return _h


_register_legacy_spa_redirects()


@router.get("/")
async def root(request: Request) -> RedirectResponse:
    if request.session.get("admin"):
        return RedirectResponse(_app("/projects"), status_code=HTTP_302_FOUND)
    return RedirectResponse(_app("/login"), status_code=HTTP_302_FOUND)


@router.get("/login")
async def login_alias(request: Request) -> RedirectResponse:
    if request.session.get("admin"):
        return RedirectResponse(_app("/projects"), status_code=HTTP_302_FOUND)
    return RedirectResponse(_app("/login"), status_code=HTTP_302_FOUND)


@router.post("/logout")
async def logout_form(request: Request, csrf: Annotated[str, Form()]) -> RedirectResponse:
    """HTML form POST compatibility; the React app uses POST /api/v1/auth/logout."""
    check_csrf(request, csrf)
    request.session.clear()
    return RedirectResponse(_app("/login"), status_code=HTTP_302_FOUND)


@router.get("/env/{env_token}")
@limiter.limit("60/minute")
async def download_env_by_secret_token(
    request: Request,
    env_token: str,
    format: Literal["dotenv", "json"] = Query("dotenv"),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Public download: token maps to a bundle export or merged stack export (no names in URL)."""
    raw = (env_token or "").strip()
    if len(raw) < 16 or len(raw) > 256:
        raise HTTPException(status_code=404, detail="Not found")
    digest = token_sha256_hex(raw)
    r = await session.execute(
        select(BundleEnvLink, Bundle)
        .join(Bundle, BundleEnvLink.bundle_id == Bundle.id)
        .where(BundleEnvLink.token_sha256 == digest)
    )
    row = r.one_or_none()
    if row is not None:
        _link, bundle = row
        _, secrets_map = await load_bundle_secrets(session, bundle.name)
    else:
        rs = await session.execute(
            select(StackEnvLink, BundleStack)
            .join(BundleStack, StackEnvLink.stack_id == BundleStack.id)
            .where(StackEnvLink.token_sha256 == digest)
        )
        row2 = rs.one_or_none()
        if row2 is None:
            raise HTTPException(status_code=404, detail="Not found")
        slink, stack = row2
        stack = await get_stack_by_name(session, stack.name)
        assert stack is not None
        if slink.through_layer_position is not None:
            secrets_map = await load_stack_secrets_through(
                session, stack, slink.through_layer_position
            )
        else:
            secrets_map = await load_stack_secrets(session, stack)
    if format == "json":
        body = json.dumps(secrets_map, sort_keys=True, indent=2) + "\n"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="environment.json"'},
        )
    text = format_secrets_dotenv(secrets_map)
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="environment.env"'},
    )
