"""CSRF token helpers shared by HTML forms and JSON auth routes."""

import secrets

from fastapi import HTTPException
from starlette.requests import Request


def csrf_token(request: Request) -> str:
    tok = request.session.get("csrf")
    if not tok:
        tok = secrets.token_hex(16)
        request.session["csrf"] = tok
    return tok


def check_csrf(request: Request, csrf: str | None) -> None:
    expected = request.session.get("csrf")
    if not csrf or not expected or csrf != expected:
        raise HTTPException(status_code=400, detail="Invalid CSRF token")
