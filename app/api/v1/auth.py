"""JSON login/session endpoints for the React admin (cookie session + CSRF)."""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.auth_keys import verify_api_key
from app.db import get_db
from app.models import ApiKey
from app.services.oidc import (
    build_authorization_redirect_url,
    decode_and_validate_id_token,
    exchange_code_for_tokens,
    fetch_discovery_document,
    generate_oauth_state,
    generate_pkce_pair,
)
from app.services.oidc_config import (
    email_allowed_for_oidc,
    load_effective_oidc_config,
    oidc_callback_redirect_uri,
)
from app.services.scopes import parse_scopes_json, scopes_allow_admin
from app.session_csrf import check_csrf, csrf_token

router = APIRouter()


class LoginBody(BaseModel):
    api_key: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    csrf_token: str


class SessionResponse(BaseModel):
    admin: bool


class LoginOptionsResponse(BaseModel):
    oidc_available: bool


def _oidc_error_redirect() -> RedirectResponse:
    return RedirectResponse(url="/login?oidc_error=1", status_code=302)


@router.get("/auth/login-options", response_model=LoginOptionsResponse)
async def auth_login_options(session: AsyncSession = Depends(get_db)) -> LoginOptionsResponse:
    cfg = await load_effective_oidc_config(session)
    return LoginOptionsResponse(oidc_available=cfg.is_login_ready())


@router.get("/auth/csrf", response_model=LoginResponse)
async def auth_csrf(request: Request) -> LoginResponse:
    """Return a CSRF token (creates session cookie if needed)."""
    return LoginResponse(csrf_token=csrf_token(request))


@router.get("/auth/session", response_model=SessionResponse)
async def auth_session(request: Request) -> SessionResponse:
    return SessionResponse(admin=bool(request.session.get("admin")))


@router.post("/auth/login", response_model=LoginResponse)
async def auth_login(
    request: Request,
    body: LoginBody,
    session: AsyncSession = Depends(get_db),
    x_csrf_token: Annotated[str | None, Header()] = None,
) -> LoginResponse:
    check_csrf(request, x_csrf_token)
    raw = body.api_key.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="API key required")
    r = await session.execute(select(ApiKey))
    rows = r.scalars().all()
    for row in rows:
        if verify_api_key(raw, row.key_hash) and scopes_allow_admin(parse_scopes_json(row.scopes)):
            request.session["admin"] = True
            request.session["admin_key_id"] = row.id
            request.session.pop("csrf", None)
            return LoginResponse(csrf_token=csrf_token(request))
    raise HTTPException(status_code=401, detail="Invalid admin API key")


@router.post("/auth/logout", status_code=204)
async def auth_logout(
    request: Request,
    x_csrf_token: Annotated[str | None, Header()] = None,
) -> None:
    check_csrf(request, x_csrf_token)
    request.session.clear()


@router.get("/auth/oidc/login")
async def oidc_login(request: Request, session: AsyncSession = Depends(get_db)) -> RedirectResponse:
    cfg = await load_effective_oidc_config(session)
    if not cfg.is_login_ready():
        raise HTTPException(status_code=400, detail="OIDC login is not configured")
    redirect_uri = oidc_callback_redirect_uri(request, cfg)
    state = generate_oauth_state()
    nonce = generate_oauth_state()
    verifier, challenge = generate_pkce_pair()
    request.session["oidc_state"] = state
    request.session["oidc_nonce"] = nonce
    request.session["oidc_code_verifier"] = verifier
    request.session["oidc_redirect_uri"] = redirect_uri

    async with httpx.AsyncClient(timeout=30.0) as client:
        discovery = await fetch_discovery_document(cfg.issuer, client)
    url = build_authorization_redirect_url(
        discovery=discovery,
        client_id=cfg.client_id,
        redirect_uri=redirect_uri,
        scopes=cfg.scopes,
        state=state,
        nonce=nonce,
        code_challenge=challenge,
    )
    return RedirectResponse(url=url, status_code=302)


@router.get("/auth/oidc/callback", name="oidc_callback")
async def oidc_callback(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    err = request.query_params.get("error")
    if err:
        return _oidc_error_redirect()
    code = request.query_params.get("code")
    state_q = request.query_params.get("state")
    if not code or not state_q:
        return _oidc_error_redirect()

    if state_q != request.session.get("oidc_state"):
        return _oidc_error_redirect()
    nonce = request.session.get("oidc_nonce")
    verifier = request.session.get("oidc_code_verifier")
    redirect_uri = request.session.get("oidc_redirect_uri")
    if not isinstance(nonce, str) or not isinstance(verifier, str) or not isinstance(redirect_uri, str):
        return _oidc_error_redirect()

    cfg = await load_effective_oidc_config(session)
    if not cfg.client_secret or not cfg.proxy_admin_key_id:
        return _oidc_error_redirect()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            discovery = await fetch_discovery_document(cfg.issuer, client)
            tokens = await exchange_code_for_tokens(
                discovery=discovery,
                client=client,
                code=code,
                redirect_uri=redirect_uri,
                client_id=cfg.client_id,
                client_secret=cfg.client_secret,
                code_verifier=verifier,
            )
        id_token = tokens.get("id_token")
        if not id_token or not isinstance(id_token, str):
            return _oidc_error_redirect()
        payload = decode_and_validate_id_token(
            id_token=id_token,
            discovery=discovery,
            client_id=cfg.client_id,
            nonce=nonce,
        )
    except Exception:
        return _oidc_error_redirect()

    email = payload.get("email")
    if not email_allowed_for_oidc(email if isinstance(email, str) else None, cfg.allowed_email_domains):
        return _oidc_error_redirect()

    kid = cfg.proxy_admin_key_id
    r = await session.execute(select(ApiKey).where(ApiKey.id == kid))
    key_row = r.scalar_one_or_none()
    if key_row is None or not scopes_allow_admin(parse_scopes_json(key_row.scopes)):
        return _oidc_error_redirect()

    request.session["admin"] = True
    request.session["admin_key_id"] = kid
    sub = payload.get("sub")
    if isinstance(sub, str):
        request.session["oidc_sub"] = sub
    if isinstance(email, str):
        request.session["oidc_email"] = email
    request.session.pop("csrf", None)
    for k in ("oidc_state", "oidc_nonce", "oidc_code_verifier", "oidc_redirect_uri"):
        request.session.pop(k, None)

    dest = cfg.post_login_path if cfg.post_login_path.startswith("/") else f"/{cfg.post_login_path}"
    return RedirectResponse(url=dest, status_code=302)
