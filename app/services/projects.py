import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BundleGroup

PROJECT_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9 _.,/'()+-]{0,254}$")
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,126}$")

# Avoid clashing with fixed routes like GET /projects/new
RESERVED_PROJECT_SLUGS = frozenset({"new", "groups", "edit"})


def validate_project_name(name: str) -> None:
    n = name.strip()
    if not n or len(n) > 256:
        raise HTTPException(
            status_code=400,
            detail="Project name: 1–256 characters after trim.",
        )
    if not PROJECT_NAME_RE.match(n):
        raise HTTPException(
            status_code=400,
            detail=(
                "Project name: start with a letter or number; "
                "then letters, numbers, spaces, and .,_/'()+- only."
            ),
        )


def validate_project_slug(slug: str) -> None:
    s = slug.strip()
    if not s or len(s) > 128:
        raise HTTPException(
            status_code=400,
            detail="Project slug: 1–128 characters after trim.",
        )
    if not PROJECT_SLUG_RE.match(s):
        raise HTTPException(
            status_code=400,
            detail=(
                "Project slug: start with a letter or number; "
                "then lowercase letters, numbers, ., _, - only."
            ),
        )
    if s in RESERVED_PROJECT_SLUGS:
        raise HTTPException(
            status_code=400,
            detail=f"Project slug {s!r} is reserved.",
        )


def slug_suggestion_from_name(name: str) -> str:
    """Default slug from display name (for UX hints only)."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-") or "project"
    if s in RESERVED_PROJECT_SLUGS:
        s = f"{s}-1"
    return s[:128]


async def get_project_or_404(session: AsyncSession, group_id: int) -> BundleGroup:
    r = await session.execute(select(BundleGroup).where(BundleGroup.id == group_id))
    g = r.scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return g


async def get_project_by_slug_or_404(session: AsyncSession, slug: str) -> BundleGroup:
    s = slug.strip()
    if not s:
        raise HTTPException(status_code=404, detail="Project not found")
    r = await session.execute(select(BundleGroup).where(BundleGroup.slug == s))
    g = r.scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return g


async def next_available_slug(session: AsyncSession, base: str) -> str:
    """Pick first unused slug: `base`, then `base-2`, `base-3`, … (base trimmed to fit)."""
    b = base.strip()[:128] or "project"
    for n in range(1, 10_000):
        candidate = b if n == 1 else f"{b[:120]}-{n}"
        candidate = candidate[:128]
        r = await session.execute(select(BundleGroup.id).where(BundleGroup.slug == candidate))
        if r.scalar_one_or_none() is None:
            return candidate
    raise HTTPException(status_code=500, detail="Could not allocate a unique project slug")
