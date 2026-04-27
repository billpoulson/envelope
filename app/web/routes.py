"""Browser routes without Jinja: public env downloads, SPA redirects, legacy path aliases."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse, RedirectResponse
from starlette.status import HTTP_302_FOUND

from app.db import get_db
from app.limiter import limiter
from app.models import Bundle, BundleEnvLink, BundleStack, StackEnvLink
from app.services.audit import emit_audit_event, last_access_metadata_from_request
from app.paths import url_path
from app.services.bundles import format_secrets_dotenv, load_bundle_secrets
from app.services.env_links import token_sha256_hex
from app.services.stacks import get_stack_by_name, load_stack_secrets, load_stack_secrets_through
from app.session_csrf import check_csrf

router = APIRouter()

_CLI_DIR = Path(__file__).resolve().parent.parent.parent / "cli"

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
        link, bundle = row
        _, secrets_map = await load_bundle_secrets(session, bundle.name)
        link.last_accessed_at = datetime.now(timezone.utc)
        for key, value in last_access_metadata_from_request(request).items():
            setattr(link, key, value)
        await session.commit()
        await emit_audit_event(
            session,
            request,
            event_type="env_link.download",
            actor=None,
            bundle_id=bundle.id,
            bundle_name=bundle.name,
            bundle_env_link_id=link.id,
            token_sha256_prefix=digest[:8],
            details={"format": format, "kind": "bundle"},
        )
    else:
        rs = await session.execute(
            select(StackEnvLink, BundleStack)
            .join(BundleStack, StackEnvLink.stack_id == BundleStack.id)
            .where(StackEnvLink.token_sha256 == digest)
        )
        row2 = rs.one_or_none()
        if row2 is None:
            raise HTTPException(status_code=404, detail="Not found")
        slink, _stack_row = row2
        stack = await get_stack_by_name(session, _stack_row.name)
        assert stack is not None
        slink.last_accessed_at = datetime.now(timezone.utc)
        for key, value in last_access_metadata_from_request(request).items():
            setattr(slink, key, value)
        await session.commit()
        if slink.through_layer_position is not None:
            secrets_map = await load_stack_secrets_through(
                session, stack, slink.through_layer_position
            )
        else:
            secrets_map = await load_stack_secrets(session, stack)
        await emit_audit_event(
            session,
            request,
            event_type="env_link.download",
            actor=None,
            stack_id=stack.id,
            stack_name=stack.name,
            stack_env_link_id=slink.id,
            token_sha256_prefix=digest[:8],
            details={
                "format": format,
                "kind": "stack",
                "through_layer_position": slink.through_layer_position,
            },
        )
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


def _cli_file_response(name: str) -> FileResponse:
    path = _CLI_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = "text/plain; charset=utf-8"
    if name.endswith(".py"):
        media = "text/x-python; charset=utf-8"
    return FileResponse(path, media_type=media, filename=name)


@router.get("/cli/envelope-run.sh")
async def download_cli_envelope_run_sh() -> FileResponse:
    """Installable shell wrapper for the opaque-env CLI (requires envelope_run.py alongside)."""
    return _cli_file_response("envelope-run.sh")


@router.get("/cli/envelope-run.ps1")
async def download_cli_envelope_run_ps1() -> FileResponse:
    """Installable PowerShell wrapper for the opaque-env CLI."""
    return _cli_file_response("envelope-run.ps1")


@router.get("/cli/envelope_run.py")
async def download_cli_envelope_run_py() -> FileResponse:
    """Python implementation: fetch /env/{{token}} and run a command or write an env file."""
    return _cli_file_response("envelope_run.py")


@router.get("/cli/envelope")
async def download_cli_envelope_sh() -> FileResponse:
    """POSIX launcher: ``envelope`` on PATH or ``python3 -m envelope_cli`` from checkout."""
    return _cli_file_response("envelope")


_SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"


@router.get("/cli/install-envelope-cli.sh")
async def download_install_envelope_cli_sh() -> FileResponse:
    path = _SCRIPTS_DIR / "install-envelope-cli.sh"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/plain; charset=utf-8", filename="install-envelope-cli.sh")


@router.get("/cli/install-envelope-cli.ps1")
async def download_install_envelope_cli_ps1() -> FileResponse:
    path = _SCRIPTS_DIR / "install-envelope-cli.ps1"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        path,
        media_type="text/plain; charset=utf-8",
        filename="install-envelope-cli.ps1",
    )
