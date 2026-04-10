"""Terraform HTTP backend–compatible state blobs (GET/POST/DELETE + optional LOCK/UNLOCK)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_api_key_bearer_or_basic, get_api_key_for_tfstate_http
from app.limiter import limiter
from app.models import ApiKey, BundleGroup, PulumiStateBlob, PulumiStateLock
from app.services.projects import get_project_by_slug_or_404
from app.services.scopes import can_read_project, can_write_project, parse_scopes_json

router = APIRouter()


def _lock_id_from_body(body: str) -> str | None:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict) and "ID" in data:
        return str(data["ID"])
    return None


def _normalize_state_path(state_path: str) -> str:
    p = state_path.strip().strip("/")
    if not p:
        raise HTTPException(status_code=400, detail="Invalid state path")
    parts = [x for x in p.replace("\\", "/").split("/") if x]
    if not parts:
        raise HTTPException(status_code=400, detail="Invalid state path")
    for seg in parts:
        if seg in (".", ".."):
            raise HTTPException(status_code=400, detail="Invalid state path")
    return "/".join(parts)


async def _terraform_state_dispatch(
    request: Request,
    session: AsyncSession,
    storage_key: str,
) -> Response:
    if request.method == "GET":
        r = await session.execute(select(PulumiStateBlob).where(PulumiStateBlob.key == storage_key))
        row = r.scalar_one_or_none()
        if row is None:
            return Response(status_code=404)
        return Response(content=row.body, media_type="application/octet-stream")

    if request.method == "POST":
        body = await request.body()
        r = await session.execute(select(PulumiStateBlob).where(PulumiStateBlob.key == storage_key))
        row = r.scalar_one_or_none()
        if row is None:
            session.add(PulumiStateBlob(key=storage_key, body=body))
        else:
            row.body = body
        await session.commit()
        return Response(status_code=200)

    if request.method == "DELETE":
        await session.execute(delete(PulumiStateBlob).where(PulumiStateBlob.key == storage_key))
        await session.commit()
        return Response(status_code=200)

    if request.method == "LOCK":
        raw = (await request.body()).decode("utf-8", errors="replace")
        lr = await session.execute(select(PulumiStateLock).where(PulumiStateLock.key == storage_key))
        existing = lr.scalar_one_or_none()
        if existing is not None:
            new_id = _lock_id_from_body(raw)
            old_id = _lock_id_from_body(existing.lock_body)
            if new_id and old_id and new_id == old_id:
                existing.lock_body = raw
                await session.commit()
                return Response(status_code=200, content=raw, media_type="application/json")
            return Response(
                status_code=423,
                content=existing.lock_body.encode("utf-8"),
                media_type="application/json",
            )
        session.add(PulumiStateLock(key=storage_key, lock_body=raw))
        await session.commit()
        return Response(status_code=200, content=raw, media_type="application/json")

    if request.method == "UNLOCK":
        raw = (await request.body()).decode("utf-8", errors="replace")
        lr = await session.execute(select(PulumiStateLock).where(PulumiStateLock.key == storage_key))
        existing = lr.scalar_one_or_none()
        if existing is None:
            return Response(status_code=200)
        new_id = _lock_id_from_body(raw)
        old_id = _lock_id_from_body(existing.lock_body)
        if new_id and old_id and new_id != old_id:
            return Response(
                status_code=423,
                content=existing.lock_body.encode("utf-8"),
                media_type="application/json",
            )
        await session.execute(delete(PulumiStateLock).where(PulumiStateLock.key == storage_key))
        await session.commit()
        return Response(status_code=200)

    raise HTTPException(status_code=405, detail="Method not allowed")


@router.api_route(
    "/projects/{project_slug}/{state_path:path}",
    methods=["GET", "POST", "DELETE", "LOCK", "UNLOCK"],
)
@limiter.limit("120/minute")
async def terraform_state_project_blob(
    request: Request,
    project_slug: str,
    state_path: str,
    session: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(get_api_key_bearer_or_basic),
) -> Response:
    """Per-project state: requires read:project… / write:project… for that project (or admin)."""
    g: BundleGroup = await get_project_by_slug_or_404(session, project_slug)
    scopes = parse_scopes_json(key.scopes)
    if request.method == "GET":
        if not can_read_project(
            scopes,
            project_id=g.id,
            project_name=g.name,
            project_slug=g.slug,
        ):
            raise HTTPException(status_code=403, detail="Insufficient scope to read this project's state")
    else:
        if not can_write_project(
            scopes,
            project_id=g.id,
            project_name=g.name,
            project_slug=g.slug,
        ):
            raise HTTPException(status_code=403, detail="Insufficient scope to write this project's state")

    norm = _normalize_state_path(state_path)
    storage_key = f"projects/{g.slug}/{norm}"
    return await _terraform_state_dispatch(request, session, storage_key)


@router.api_route(
    "/blobs/{key:path}",
    methods=["GET", "POST", "DELETE", "LOCK", "UNLOCK"],
)
@limiter.limit("120/minute")
async def terraform_state_blob_legacy(
    request: Request,
    key: str,
    session: AsyncSession = Depends(get_db),
    _key_row: ApiKey = Depends(get_api_key_for_tfstate_http),
) -> Response:
    """Legacy flat keys; requires terraform:http_state (or admin). Prefer /projects/{slug}/…."""
    if not key or key.endswith("/"):
        raise HTTPException(status_code=400, detail="Invalid key")
    if key.startswith("projects/"):
        raise HTTPException(
            status_code=400,
            detail="Use /tfstate/projects/… for project-scoped state, not a projects/… key under /blobs/",
        )
    return await _terraform_state_dispatch(request, session, key)
