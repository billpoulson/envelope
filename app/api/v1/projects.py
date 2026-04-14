from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_api_key
from app.models import ApiKey, Bundle, BundleGroup
from app.services.projects import (
    get_project_by_slug_or_404,
    next_available_slug,
    slug_suggestion_from_name,
    validate_project_name,
    validate_project_slug,
)
from app.services.scopes import (
    can_create_project,
    can_read_project,
    can_write_project,
    parse_scopes_json,
    scopes_allow_admin,
)

router = APIRouter()


class CreateProjectBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    slug: str | None = Field(None, max_length=128)


class UpdateProjectBody(BaseModel):
    name: str | None = Field(None, max_length=256)
    slug: str | None = Field(None, max_length=128)


@router.get("/projects")
async def list_projects(
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, int | str]]:
    scopes = parse_scopes_json(key.scopes)
    r = await session.execute(
        select(BundleGroup.id, BundleGroup.name, BundleGroup.slug, func.count(Bundle.id).label("n"))
        .outerjoin(Bundle, Bundle.group_id == BundleGroup.id)
        .group_by(BundleGroup.id, BundleGroup.name, BundleGroup.slug)
        .order_by(BundleGroup.name)
    )
    rows = r.all()
    if scopes_allow_admin(scopes):
        return [
            {
                "id": row.id,
                "name": row.name,
                "slug": row.slug,
                "bundle_count": int(row.n),
            }
            for row in rows
        ]
    out: list[dict[str, int | str]] = []
    for row in rows:
        if can_read_project(
            scopes,
            project_id=row.id,
            project_name=row.name,
            project_slug=row.slug,
        ) or can_write_project(
            scopes,
            project_id=row.id,
            project_name=row.name,
            project_slug=row.slug,
        ):
            out.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "slug": row.slug,
                    "bundle_count": int(row.n),
                }
            )
    return out


@router.post("/projects", status_code=201)
async def create_project(
    body: CreateProjectBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, int | str]:
    scopes = parse_scopes_json(key.scopes)
    if not can_create_project(scopes):
        raise HTTPException(status_code=403, detail="Insufficient scope to create a project")
    name = body.name.strip()
    validate_project_name(name)
    existing_name = await session.execute(select(BundleGroup.id).where(BundleGroup.name == name))
    if existing_name.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Project name already exists")

    if body.slug is not None and str(body.slug).strip():
        slug = str(body.slug).strip()
        validate_project_slug(slug)
        taken = await session.execute(select(BundleGroup.id).where(BundleGroup.slug == slug))
        if taken.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="Project slug already exists")
    else:
        base = slug_suggestion_from_name(name)
        validate_project_slug(base)
        slug = await next_available_slug(session, base)

    g = BundleGroup(name=name, slug=slug)
    session.add(g)
    await session.commit()
    await session.refresh(g)
    return {"id": g.id, "name": g.name, "slug": g.slug}


@router.patch("/projects/{project_slug}")
async def update_project(
    project_slug: str,
    body: UpdateProjectBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, int | str]:
    if body.name is None and body.slug is None:
        raise HTTPException(status_code=400, detail="Provide at least one of: name, slug")

    scopes = parse_scopes_json(key.scopes)
    g = await get_project_by_slug_or_404(session, project_slug)
    if not can_write_project(
        scopes,
        project_id=g.id,
        project_name=g.name,
        project_slug=g.slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this project")

    if body.name is not None:
        name = body.name.strip()
        validate_project_name(name)
        dup = await session.execute(
            select(BundleGroup.id).where(BundleGroup.name == name, BundleGroup.id != g.id),
        )
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="Project name already exists")
        g.name = name

    if body.slug is not None:
        slug = body.slug.strip()
        validate_project_slug(slug)
        dup = await session.execute(
            select(BundleGroup.id).where(BundleGroup.slug == slug, BundleGroup.id != g.id),
        )
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="Project slug already exists")
        g.slug = slug

    await session.commit()
    await session.refresh(g)
    return {"id": g.id, "name": g.name, "slug": g.slug}


@router.delete("/projects/{project_slug}", status_code=204)
async def delete_project(
    project_slug: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    scopes = parse_scopes_json(key.scopes)
    g = await get_project_by_slug_or_404(session, project_slug)
    if not can_write_project(
        scopes,
        project_id=g.id,
        project_name=g.name,
        project_slug=g.slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this project")
    await session.execute(delete(BundleGroup).where(BundleGroup.id == g.id))
    await session.commit()
    return Response(status_code=204)
