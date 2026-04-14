"""JSON login/session endpoints for the React admin (cookie session + CSRF)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from starlette.requests import Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_keys import verify_api_key
from app.db import get_db
from app.models import ApiKey
from app.services.scopes import parse_scopes_json, scopes_allow_admin
from app.session_csrf import check_csrf, csrf_token

router = APIRouter()


class LoginBody(BaseModel):
    api_key: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    csrf_token: str


class SessionResponse(BaseModel):
    admin: bool


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
