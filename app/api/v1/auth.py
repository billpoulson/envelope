"""JSON login/session endpoints for the React admin (cookie session + CSRF)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.db import get_db
from app.deps import get_api_key, resolve_api_key
from app.limiter import OIDC_CALLBACK, OIDC_REDIRECT, limiter, LOGIN
from app.models import ApiKey, OidcIdentity
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
    oidc_configured: bool


class OidcStatusResponse(BaseModel):
    linked: bool
    issuer: str | None = None
    email: str | None = None


def _oidc_error_redirect(code: str = "1") -> RedirectResponse:
    return RedirectResponse(url=f"/login?oidc_error={code}", status_code=302)


def _account_error_redirect(code: str) -> RedirectResponse:
    return RedirectResponse(url=f"/account?oidc_error={code}", status_code=302)


def _oidc_not_configured_login_redirect() -> RedirectResponse:
    """Unauthenticated SSO entry: explain on the login page."""
    return RedirectResponse(url="/login?oidc_info=not_configured", status_code=302)


def _oidc_not_configured_account_redirect() -> RedirectResponse:
    """Link flow hit without IdP config: show message on Account (same tab after redirect)."""
    return RedirectResponse(url="/account?oidc_info=not_configured", status_code=302)


def _clear_oidc_flow_keys(request: Request) -> None:
    for k in (
        "oidc_state",
        "oidc_nonce",
        "oidc_code_verifier",
        "oidc_redirect_uri",
        "oidc_intent",
        "oidc_link_key_id",
    ):
        request.session.pop(k, None)


@router.get("/auth/login-options", response_model=LoginOptionsResponse)
async def auth_login_options(session: AsyncSession = Depends(get_db)) -> LoginOptionsResponse:
    cfg = await load_effective_oidc_config(session)
    return LoginOptionsResponse(oidc_configured=cfg.is_oidc_configured())


@router.get("/auth/oidc/status", response_model=OidcStatusResponse)
async def oidc_link_status(
    request: Request,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> OidcStatusResponse:
    r = await session.execute(select(OidcIdentity).where(OidcIdentity.api_key_id == key.id))
    row = r.scalar_one_or_none()
    if row is None:
        return OidcStatusResponse(linked=False)
    return OidcStatusResponse(linked=True, issuer=row.issuer, email=row.email)


@router.delete("/auth/oidc/link")
async def oidc_unlink(
    request: Request,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
    x_csrf_token: Annotated[str | None, Header()] = None,
) -> Response:
    check_csrf(request, x_csrf_token)
    await session.execute(delete(OidcIdentity).where(OidcIdentity.api_key_id == key.id))
    await session.commit()
    return Response(status_code=204)


@router.get("/auth/csrf", response_model=LoginResponse)
async def auth_csrf(request: Request) -> LoginResponse:
    """Return a CSRF token (creates session cookie if needed)."""
    return LoginResponse(csrf_token=csrf_token(request))


@router.get("/auth/session", response_model=SessionResponse)
async def auth_session(request: Request) -> SessionResponse:
    return SessionResponse(admin=bool(request.session.get("admin")))


@router.post("/auth/login", response_model=LoginResponse)
@limiter.limit(LOGIN)
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
    try:
        row = await resolve_api_key(raw, session)
    except HTTPException as e:
        if e.status_code != 401:
            raise
        if e.detail == "API key expired":
            raise
        raise HTTPException(status_code=401, detail="Invalid admin API key") from e
    if not scopes_allow_admin(parse_scopes_json(row.scopes)):
        raise HTTPException(status_code=401, detail="Invalid admin API key")
    request.session["admin"] = True
    request.session["admin_key_id"] = row.id
    request.session.pop("csrf", None)
    return LoginResponse(csrf_token=csrf_token(request))


@router.post("/auth/logout")
async def auth_logout(
    request: Request,
    x_csrf_token: Annotated[str | None, Header()] = None,
) -> Response:
    check_csrf(request, x_csrf_token)
    request.session.clear()
    return Response(status_code=204)


@router.get("/auth/oidc/login")
@limiter.limit(OIDC_REDIRECT)
async def oidc_login_start(request: Request, session: AsyncSession = Depends(get_db)) -> RedirectResponse:
    cfg = await load_effective_oidc_config(session)
    if not cfg.is_oidc_configured():
        return _oidc_not_configured_login_redirect()
    redirect_uri = oidc_callback_redirect_uri(request, cfg)
    state = generate_oauth_state()
    nonce = generate_oauth_state()
    verifier, challenge = generate_pkce_pair()
    request.session["oidc_state"] = state
    request.session["oidc_nonce"] = nonce
    request.session["oidc_code_verifier"] = verifier
    request.session["oidc_redirect_uri"] = redirect_uri
    request.session["oidc_intent"] = "login"
    request.session.pop("oidc_link_key_id", None)

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


@router.get("/auth/oidc/link")
@limiter.limit(OIDC_REDIRECT)
async def oidc_link_start(
    request: Request,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if not scopes_allow_admin(parse_scopes_json(key.scopes)):
        raise HTTPException(status_code=403, detail="Admin scope required")
    cfg = await load_effective_oidc_config(session)
    if not cfg.is_oidc_configured():
        return _oidc_not_configured_account_redirect()
    redirect_uri = oidc_callback_redirect_uri(request, cfg)
    state = generate_oauth_state()
    nonce = generate_oauth_state()
    verifier, challenge = generate_pkce_pair()
    request.session["oidc_state"] = state
    request.session["oidc_nonce"] = nonce
    request.session["oidc_code_verifier"] = verifier
    request.session["oidc_redirect_uri"] = redirect_uri
    request.session["oidc_intent"] = "link"
    request.session["oidc_link_key_id"] = key.id

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
@limiter.limit(OIDC_CALLBACK)
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
    intent = request.session.get("oidc_intent", "login")
    link_key_id = request.session.get("oidc_link_key_id")

    if not isinstance(nonce, str) or not isinstance(verifier, str) or not isinstance(redirect_uri, str):
        return _oidc_error_redirect()

    cfg = await load_effective_oidc_config(session)
    if not cfg.client_secret:
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

    iss = str(discovery.get("issuer", "")).rstrip("/")
    sub_raw = payload.get("sub")
    if not iss or not isinstance(sub_raw, str) or not sub_raw.strip():
        return _oidc_error_redirect()
    sub = sub_raw.strip()

    email = payload.get("email")
    email_str = email if isinstance(email, str) else None
    if not email_allowed_for_oidc(email_str, cfg.allowed_email_domains):
        return _oidc_error_redirect()

    if intent == "link":
        try:
            link_kid = int(link_key_id) if link_key_id is not None else None
        except (TypeError, ValueError):
            link_kid = None
        if link_kid is None:
            return _account_error_redirect("session")
        raw_admin = request.session.get("admin_key_id")
        try:
            sess_kid = int(raw_admin) if raw_admin is not None else None
        except (TypeError, ValueError):
            sess_kid = None
        if sess_kid != link_kid or not request.session.get("admin"):
            return _account_error_redirect("session")

        r_key = await session.execute(select(ApiKey).where(ApiKey.id == link_kid))
        key_row = r_key.scalar_one_or_none()
        if key_row is None or not scopes_allow_admin(parse_scopes_json(key_row.scopes)):
            return _account_error_redirect("session")

        r_exist = await session.execute(
            select(OidcIdentity).where(OidcIdentity.issuer == iss, OidcIdentity.sub == sub)
        )
        taken = r_exist.scalar_one_or_none()
        if taken is not None and taken.api_key_id != link_kid:
            _clear_oidc_flow_keys(request)
            return _account_error_redirect("linked_other")

        await session.execute(delete(OidcIdentity).where(OidcIdentity.api_key_id == link_kid))
        now = datetime.now(timezone.utc)
        session.add(
            OidcIdentity(
                issuer=iss,
                sub=sub,
                email=email_str,
                api_key_id=link_kid,
                linked_at=now,
                last_login_at=now,
            )
        )
        await session.commit()

        request.session.pop("csrf", None)
        _clear_oidc_flow_keys(request)
        return RedirectResponse(url="/account?oidc_linked=1", status_code=302)

    # login intent
    r_id = await session.execute(select(OidcIdentity).where(OidcIdentity.issuer == iss, OidcIdentity.sub == sub))
    oid_row = r_id.scalar_one_or_none()
    if oid_row is None:
        _clear_oidc_flow_keys(request)
        return RedirectResponse(url="/login?oidc_error=unlinked", status_code=302)

    r_k = await session.execute(select(ApiKey).where(ApiKey.id == oid_row.api_key_id))
    krow = r_k.scalar_one_or_none()
    if krow is None or not scopes_allow_admin(parse_scopes_json(krow.scopes)):
        _clear_oidc_flow_keys(request)
        return _oidc_error_redirect()

    oid_row.last_login_at = datetime.now(timezone.utc)
    if email_str:
        oid_row.email = email_str
    await session.commit()

    request.session["admin"] = True
    request.session["admin_key_id"] = oid_row.api_key_id
    request.session["oidc_sub"] = sub
    if email_str:
        request.session["oidc_email"] = email_str
    request.session.pop("csrf", None)
    _clear_oidc_flow_keys(request)

    dest = cfg.post_login_path if cfg.post_login_path.startswith("/") else f"/{cfg.post_login_path}"
    return RedirectResponse(url=dest, status_code=302)
