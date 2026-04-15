"""Validation and slug helpers for per-project environments (Local, Prod, …)."""

from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ProjectEnvironment

# Query param / filter: list only bundles/stacks with no environment assigned.
UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL = "__unassigned__"

_ENV_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9 _.,/'()+-]{0,126}$")
_ENV_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,62}$")


def validate_environment_name(name: str) -> None:
    n = name.strip()
    if not n or len(n) > 128:
        raise HTTPException(
            status_code=400,
            detail="Environment name: 1–128 characters after trim.",
        )
    if not _ENV_NAME_RE.match(n):
        raise HTTPException(
            status_code=400,
            detail=(
                "Environment name: start with a letter or number; "
                "then letters, numbers, spaces, and .,_/'()+- only."
            ),
        )


def validate_environment_slug(slug: str) -> None:
    s = slug.strip()
    if not s or len(s) > 64:
        raise HTTPException(
            status_code=400,
            detail="Environment slug: 1–64 characters after trim.",
        )
    if not _ENV_SLUG_RE.match(s):
        raise HTTPException(
            status_code=400,
            detail=(
                "Environment slug: start with a letter or number; "
                "then lowercase letters, numbers, ., _, - only."
            ),
        )


def slug_suggestion_from_name(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-") or "env"
    return s[:64]


async def next_available_env_slug(
    session: AsyncSession,
    group_id: int,
    base: str,
) -> str:
    """Pick first unused slug: ``base``, then ``base-2``, ``base-3``, … within the project."""
    b = base.strip()[:64] or "env"
    for n in range(1, 10_000):
        candidate = b if n == 1 else f"{b[:56]}-{n}"[:64]
        r = await session.execute(
            select(ProjectEnvironment.id).where(
                ProjectEnvironment.group_id == group_id,
                ProjectEnvironment.slug == candidate,
            )
        )
        if r.scalar_one_or_none() is None:
            return candidate
    raise HTTPException(status_code=500, detail="Could not allocate a unique environment slug")


async def get_project_environment_by_group_and_slug(
    session: AsyncSession,
    *,
    group_id: int,
    slug: str,
) -> ProjectEnvironment:
    """Return the environment row or 404 if the slug is not defined for this project."""
    s = slug.strip()
    r = await session.execute(
        select(ProjectEnvironment).where(
            ProjectEnvironment.group_id == group_id,
            ProjectEnvironment.slug == s,
        )
    )
    env = r.scalar_one_or_none()
    if env is None:
        raise HTTPException(
            status_code=404,
            detail="Environment not found in this project",
        )
    return env


async def resolve_project_environment_fk(
    session: AsyncSession,
    *,
    group_id: int,
    slug: str | None,
) -> int | None:
    """Resolve optional slug to ``project_environments.id`` for this project, or ``None`` (unassigned)."""
    if slug is None:
        return None
    s = str(slug).strip()
    if not s:
        return None
    env = await get_project_environment_by_group_and_slug(session, group_id=group_id, slug=s)
    return env.id


async def require_project_environment_id_for_create(
    session: AsyncSession,
    *,
    group_id: int,
    slug: str | None,
    resource: str,
) -> int:
    """Resolve slug to ``project_environments.id`` for new bundle/stack; rejects missing or unassigned."""
    if slug is None or not str(slug).strip():
        raise HTTPException(
            status_code=400,
            detail=f"project_environment_slug is required when creating a {resource}",
        )
    s = str(slug).strip()
    if s == UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL:
        raise HTTPException(
            status_code=400,
            detail=(
                f"project_environment_slug must name a project environment when creating a {resource} "
                "(not the unassigned list filter)"
            ),
        )
    env = await get_project_environment_by_group_and_slug(session, group_id=group_id, slug=s)
    return env.id
