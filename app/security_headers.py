"""Browser-oriented response headers (defense in depth; TLS + proxy headers remain primary in production)."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings

# SPA + Google Fonts (see frontend/index.html). Swagger/OpenAPI UI is excluded — it loads third-party scripts.
_DEFAULT_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

_SKIP_CSP_PREFIXES = ("/docs", "/redoc")
_SKIP_CSP_EXACT = frozenset({"/openapi.json"})


def should_attach_content_security_policy(path: str) -> bool:
    """Whether the default CSP applies to this URL path (Swagger / ReDoc / OpenAPI JSON are excluded)."""
    if path in _SKIP_CSP_EXACT:
        return False
    for prefix in _SKIP_CSP_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return False
    return True


def _csp_value(settings: Settings, path: str) -> str | None:
    if not should_attach_content_security_policy(path):
        return None
    raw = (settings.security_csp or "").strip()
    if raw.lower() in ("-", "none", "off"):
        return None
    if not raw:
        return _DEFAULT_CSP
    return raw


def make_security_headers_middleware(settings: Settings):
    async def security_headers_middleware(request: Request, call_next) -> Response:
        response = await call_next(request)
        if not settings.security_headers_enabled:
            return response
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        if settings.https_cookies:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        csp = _csp_value(settings, request.url.path)
        if csp:
            response.headers["Content-Security-Policy"] = csp
        return response

    return security_headers_middleware
