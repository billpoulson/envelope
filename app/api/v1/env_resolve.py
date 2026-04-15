"""Resolve env link digest → bundle/stack identity for admin navigation (requires write access)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key
from app.limiter import limiter
from app.models import ApiKey, Bundle, BundleEnvLink, BundleGroup, BundleStack, StackEnvLink
from app.services.project_environments import UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL
from app.services.scopes import can_write_bundle, can_write_stack, parse_scopes_json

router = APIRouter()


def _normalize_digest(token_sha256: str) -> str:
    t = "".join(token_sha256.split()).lower()
    if len(t) != 64:
        raise HTTPException(
            status_code=400,
            detail="token_sha256 must be exactly 64 hexadecimal characters",
        )
    for c in t:
        if c not in "0123456789abcdef":
            raise HTTPException(status_code=400, detail="token_sha256 must be hexadecimal")
    return t


def _group_slug(group: BundleGroup | None) -> str | None:
    return group.slug if group else None


@router.get("/env-links/resolve")
@limiter.limit("60/minute")
async def resolve_env_link_by_digest(
    request: Request,
    token_sha256: str = Query(
        ...,
        description="SHA-256 hex digest of the env path token (64 lowercase hex chars)",
    ),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | None]:
    """Return bundle or stack name and project scope for a stored env link digest.

    Caller must have env-link management access (same as ``GET …/env-links``) for that resource.
    """
    digest = _normalize_digest(token_sha256)
    scopes = parse_scopes_json(auth.scopes)

    r = await session.execute(
        select(BundleEnvLink, Bundle)
        .join(Bundle, BundleEnvLink.bundle_id == Bundle.id)
        .where(BundleEnvLink.token_sha256 == digest)
        .options(
            selectinload(Bundle.group),
            selectinload(Bundle.project_environment),
        )
    )
    row = r.one_or_none()
    if row is not None:
        _link, bundle = row
        pn = bundle.group.name if bundle.group else None
        pslug = _group_slug(bundle.group)
        if not can_write_bundle(
            scopes,
            bundle_name=bundle.name,
            bundle_slug=bundle.slug,
            group_id=bundle.group_id,
            project_name=pn,
            project_slug=pslug,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to resolve this env link",
            )
        env_slug: str | None = None
        if pslug:
            pe = bundle.project_environment
            env_slug = pe.slug if pe else UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL
        return {
            "resource": "bundle",
            "name": bundle.name,
            "slug": bundle.slug,
            "project_slug": pslug,
            "environment_slug": env_slug,
        }

    rs = await session.execute(
        select(StackEnvLink, BundleStack)
        .join(BundleStack, StackEnvLink.stack_id == BundleStack.id)
        .where(StackEnvLink.token_sha256 == digest)
        .options(
            selectinload(BundleStack.group),
            selectinload(BundleStack.project_environment),
        )
    )
    row2 = rs.one_or_none()
    if row2 is not None:
        _slink, stack = row2
        pn = stack.group.name if stack.group else None
        pslug = _group_slug(stack.group)
        if not can_write_stack(
            scopes,
            stack_name=stack.name,
            stack_slug=stack.slug,
            group_id=stack.group_id,
            project_name=pn,
            project_slug=pslug,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to resolve this env link",
            )
        env_slug = None
        if pslug:
            pe = stack.project_environment
            env_slug = pe.slug if pe else UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL
        return {
            "resource": "stack",
            "name": stack.name,
            "slug": stack.slug,
            "project_slug": pslug,
            "environment_slug": env_slug,
        }

    raise HTTPException(status_code=404, detail="No env link matches this digest")
