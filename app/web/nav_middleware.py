"""Attach selected project slug + name from the URL to request.state for admin nav (see templates/partials/nav_admin.html)."""

from __future__ import annotations

import re
from collections.abc import Callable

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.db import get_session_factory
from app.models import BundleGroup


def _selected_project_slug_from_path(path: str) -> str | None:
    """If URL is under /projects/{slug}/..., return slug (excludes /projects/new)."""
    m = re.search(r"/projects/([^/]+)/", path)
    if not m:
        return None
    seg = m.group(1)
    if seg == "new":
        return None
    return seg


class AdminNavMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request.state.nav_selected_project_slug = None
        request.state.nav_selected_project_name = None

        path = request.url.path
        skip = (
            path.startswith("/static")
            or path.startswith("/api/")
            or path.startswith("/tfstate")
        )
        if skip:
            return await call_next(request)

        if request.session.get("admin"):
            slug = _selected_project_slug_from_path(path)
            request.state.nav_selected_project_slug = slug
            if slug:
                factory = get_session_factory()
                async with factory() as session:
                    r = await session.execute(
                        select(BundleGroup.name).where(BundleGroup.slug == slug)
                    )
                    request.state.nav_selected_project_name = r.scalar_one_or_none()

        return await call_next(request)
