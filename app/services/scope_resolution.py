"""Resolve bundle/stack rows when display names can repeat across environments."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Bundle, BundleStack
from app.services.projects import get_project_by_slug_or_404

# Stable identifiers for API clients (SPA, CLI) — pair with HTTP 400.
AMBIGUOUS_BUNDLE_SCOPE_CODE = "ambiguous_bundle_scope"
AMBIGUOUS_STACK_SCOPE_CODE = "ambiguous_stack_scope"


def _bundle_matches_env_slug(b: Bundle, environment_slug: str) -> bool:
    pe = b.project_environment
    return pe is not None and pe.slug == environment_slug


def _stack_matches_env_slug(s: BundleStack, environment_slug: str) -> bool:
    pe = s.project_environment
    return pe is not None and pe.slug == environment_slug


async def fetch_bundle_for_path(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None,
    environment_slug: str | None,
) -> Bundle:
    from app.services.bundles import validate_bundle_path_segment

    validate_bundle_path_segment(name)
    nm = name.strip()
    r = await session.execute(
        select(Bundle)
        .where(or_(Bundle.slug == nm, Bundle.name == nm))
        .options(selectinload(Bundle.group), selectinload(Bundle.project_environment))
    )
    rows = list(r.scalars().all())
    if not rows:
        raise HTTPException(status_code=404, detail="Bundle not found")

    scoped: list[Bundle] | None = None
    g_id: int | None = None
    if project_slug and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        g_id = g.id
        scoped = [b for b in rows if b.group_id == g_id]
        if not scoped:
            raise HTTPException(status_code=404, detail="Bundle not found")
    else:
        scoped = rows

    # Single row in this project: name is unambiguous.
    if len(scoped) == 1:
        return scoped[0]

    es = (environment_slug or "").strip()
    if not es:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AMBIGUOUS_BUNDLE_SCOPE_CODE,
                "message": (
                    "Multiple bundles share this name; add query parameters project_slug and "
                    "environment_slug to select one."
                ),
            },
        )
    if g_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AMBIGUOUS_BUNDLE_SCOPE_CODE,
                "message": (
                    "Multiple bundles share this name; add project_slug and environment_slug to select one."
                ),
            },
        )
    for b in scoped:
        if _bundle_matches_env_slug(b, es):
            return b
    raise HTTPException(status_code=404, detail="Bundle not found")


async def fetch_stack_for_path(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None,
    environment_slug: str | None,
) -> BundleStack:
    from app.services.stacks import validate_stack_path_segment

    validate_stack_path_segment(name)
    nm = name.strip()
    r = await session.execute(
        select(BundleStack)
        .where(or_(BundleStack.slug == nm, BundleStack.name == nm))
        .options(selectinload(BundleStack.group), selectinload(BundleStack.project_environment))
    )
    rows = list(r.scalars().all())
    if not rows:
        raise HTTPException(status_code=404, detail="Stack not found")

    scoped: list[BundleStack] | None = None
    g_id: int | None = None
    if project_slug and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        g_id = g.id
        scoped = [s for s in rows if s.group_id == g_id]
        if not scoped:
            raise HTTPException(status_code=404, detail="Stack not found")
    else:
        scoped = rows

    if len(scoped) == 1:
        return scoped[0]

    es = (environment_slug or "").strip()
    if not es:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AMBIGUOUS_STACK_SCOPE_CODE,
                "message": (
                    "Multiple stacks share this name; add query parameters project_slug and "
                    "environment_slug to select one."
                ),
            },
        )
    if g_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AMBIGUOUS_STACK_SCOPE_CODE,
                "message": (
                    "Multiple stacks share this name; add project_slug and environment_slug to select one."
                ),
            },
        )
    for s in scoped:
        if _stack_matches_env_slug(s, es):
            return s
    raise HTTPException(status_code=404, detail="Stack not found")
