import json
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile

from app.api.resource_scope import ResourcePathScope
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, nulls_last, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key, get_fernet
from app.limiter import limiter
from app.models import ApiKey, Bundle, BundleEnvLink, BundleGroup, BundleStackLayer, ProjectEnvironment, Secret
from app.services.project_environments import (
    UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL,
    get_project_environment_by_group_and_slug,
    require_project_environment_id_for_create,
    resolve_project_environment_fk,
)
from app.services.projects import get_project_by_slug_or_404, get_project_or_404
from app.services.scopes import (
    can_create_bundle,
    can_read_bundle,
    can_write_bundle,
    can_write_project,
    parse_scopes_json,
    scopes_allow_admin,
)
from app.services.audit import emit_audit_event
from app.services.backup_crypto import (
    WrongPassphraseError,
    decrypt_bytes,
    encrypt_bytes_async,
)
from app.services.bundles import (
    IMPORT_KIND_VALUES,
    ImportKind,
    bulk_upsert_bundle_secrets,
    bundle_slug_suggestion_from_display_name,
    coerce_value_to_string,
    dedupe_entry_rows,
    encode_stored_value,
    declassify_secret_entry,
    encrypt_plain_entry,
    format_secrets_dotenv,
    list_bundle_secret_key_names,
    load_bundle_entries,
    load_bundle_entries_list_masked,
    load_bundle_secrets,
    normalize_env_key,
    parse_bundle_entries_dict,
    parse_bundle_initial_paste,
    validate_bundle_display_name,
    validate_bundle_path_segment,
    validate_bundle_slug,
)
from app.services.env_links import new_env_link_token
from app.services.scope_resolution import fetch_bundle_for_path

router = APIRouter()


def _bundle_scope_query(scope: ResourcePathScope) -> dict[str, str | None]:
    return {"project_slug": scope.project_slug, "environment_slug": scope.environment_slug}

BUNDLE_BACKUP_FORMAT = "envelope-bundle-backup-v1"


class BundleBackupPayloadV1(BaseModel):
    format: Literal["envelope-bundle-backup-v1"]
    bundle: str
    secrets: dict[str, Any]
    secret_flags: dict[str, bool] | None = None


class BundlePassphraseBody(BaseModel):
    passphrase: str = Field(..., min_length=1, max_length=1024)


class CreateBundleBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    slug: str | None = Field(None, max_length=128)
    # Optional initial keys (same rules as JSON paste: strings secret by default;
    # use {"K": {"value": "x", "secret": false}} or _plaintext_keys)
    entries: dict[str, Any] | None = None
    # Alternative to `entries`: raw paste + import kind (same as web bundle_new wizard).
    initial_paste: str | None = None
    import_kind: str | None = Field(
        default="skip",
        description="skip | json_object | json_array | csv_quoted | dotenv_lines",
    )
    group_id: int | None = None
    project_slug: str | None = None
    project_environment_slug: str | None = None


class ReorderBundlesBody(BaseModel):
    project_slug: str = Field(..., min_length=1)
    environment_slug: str = Field(..., min_length=1)
    slugs: list[str] = Field(
        ...,
        description="Every bundle slug in this project environment, in the desired order.",
    )


class PatchBundleBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    group_id: int | None = None
    project_slug: str | None = None
    # Same shape as POST /bundles `entries`: strings default to secret; use
    # {"KEY": {"value": "x", "secret": false}} or `_plaintext_keys` for plain rows.
    entries: dict[str, Any] | None = None
    project_environment_slug: str | None = None


    @field_validator("name")
    @classmethod
    def strip_bundle_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip()

    @field_validator("slug")
    @classmethod
    def strip_bundle_slug(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip()


class UpsertSecretBody(BaseModel):
    key_name: str = Field(..., min_length=1, max_length=512)
    value: str
    is_secret: bool = True


def _pslug(group: BundleGroup | None) -> str | None:
    return group.slug if group else None


def _bundle_list_row(b: Bundle) -> dict[str, str | None]:
    pe = b.project_environment
    return {
        "name": b.name,
        "slug": b.slug,
        "project_environment_slug": pe.slug if pe else None,
        "project_environment_name": pe.name if pe else None,
    }


@router.get("/bundles")
async def list_bundles(
    project_slug: str | None = Query(None, description="If set, only bundles in this project"),
    environment_slug: str | None = Query(
        None,
        description="With project_slug: filter by project environment slug.",
    ),
    include_unassigned: bool = Query(
        False,
        description="Deprecated; ignored. Bundles must belong to an environment.",
    ),
    with_environment: bool = Query(
        False,
        description="If true (requires project_slug), return {name, project_environment_slug, project_environment_name} per row.",
    ),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[str] | list[dict[str, str | None]]:
    scopes = parse_scopes_json(key.scopes)
    has_ps = project_slug is not None and str(project_slug).strip()
    if with_environment and not has_ps:
        raise HTTPException(
            status_code=400,
            detail="with_environment=true requires project_slug",
        )
    q = (
        select(Bundle)
        .options(selectinload(Bundle.group), selectinload(Bundle.project_environment))
        .outerjoin(ProjectEnvironment, Bundle.project_environment_id == ProjectEnvironment.id)
        .order_by(
            nulls_last(Bundle.group_id.asc()),
            nulls_last(ProjectEnvironment.sort_order.asc()),
            Bundle.sort_order.asc(),
            Bundle.name.asc(),
        )
    )
    if project_slug is not None and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        q = q.where(Bundle.group_id == g.id)
        if environment_slug is not None and str(environment_slug).strip():
            raw = str(environment_slug).strip()
            if raw == UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL:
                raise HTTPException(
                    status_code=400,
                    detail="environment_slug must be a real environment, not the legacy unassigned sentinel.",
                )
            env = await get_project_environment_by_group_and_slug(session, group_id=g.id, slug=raw)
            q = q.where(Bundle.project_environment_id == env.id)
    r = await session.execute(q)
    rows = r.scalars().all()
    if scopes_allow_admin(scopes):
        if with_environment and has_ps:
            return [_bundle_list_row(b) for b in rows]
        return [b.slug for b in rows]
    out_str: list[str] = []
    out_detail: list[dict[str, str | None]] = []
    for b in rows:
        pn = b.group.name if b.group else None
        ps = _pslug(b.group)
        if can_read_bundle(
            scopes,
            bundle_name=b.name,
            bundle_slug=b.slug,
            group_id=b.group_id,
            project_name=pn,
            project_slug=ps,
        ) or can_write_bundle(
            scopes,
            bundle_name=b.name,
            bundle_slug=b.slug,
            group_id=b.group_id,
            project_name=pn,
            project_slug=ps,
        ):
            if with_environment and has_ps:
                out_detail.append(_bundle_list_row(b))
            else:
                out_str.append(b.slug)
    return out_detail if (with_environment and has_ps) else out_str


@router.put("/bundles/order", status_code=204)
async def reorder_bundles(
    body: ReorderBundlesBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    scopes = parse_scopes_json(key.scopes)
    g = await get_project_by_slug_or_404(session, body.project_slug.strip())
    if not can_write_project(
        scopes,
        project_id=g.id,
        project_name=g.name,
        project_slug=g.slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this project")
    raw = str(body.environment_slug).strip()
    if raw == UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL:
        raise HTTPException(
            status_code=400,
            detail="environment_slug must be a real environment, not the legacy unassigned sentinel.",
        )
    env = await get_project_environment_by_group_and_slug(session, group_id=g.id, slug=raw)
    r = await session.execute(
        select(Bundle).where(
            Bundle.group_id == g.id,
            Bundle.project_environment_id == env.id,
        )
    )
    existing = {b.slug: b for b in r.scalars().all()}
    if sorted(body.slugs) != sorted(existing.keys()):
        raise HTTPException(
            status_code=400,
            detail="slugs must list every bundle in this environment exactly once",
        )
    for i, slug in enumerate(body.slugs):
        existing[slug].sort_order = i
    await session.commit()
    return Response(status_code=204)


@router.post("/bundles", status_code=201)
async def create_bundle(
    body: CreateBundleBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    display_name = body.name.strip()
    validate_bundle_display_name(display_name)
    slug_raw = (body.slug or "").strip()
    slug_out = slug_raw or bundle_slug_suggestion_from_display_name(display_name)
    validate_bundle_slug(slug_out)
    scopes = parse_scopes_json(key.scopes)
    entry_rows: list[tuple[str, str, bool]] = []
    kind_in = (body.import_kind or "skip").strip() or "skip"
    if body.entries is not None and (body.initial_paste or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Provide either entries or initial_paste, not both",
        )
    if body.entries is not None:
        entry_rows, err = parse_bundle_entries_dict(body.entries)
        if err:
            raise HTTPException(status_code=400, detail=err)
    elif kind_in != "skip" and (body.initial_paste or "").strip():
        if kind_in not in IMPORT_KIND_VALUES or kind_in == "skip":
            raise HTTPException(status_code=400, detail="Invalid import_kind")
        paste_rows, err = parse_bundle_initial_paste(
            body.initial_paste or "", cast(ImportKind, kind_in)
        )
        if err:
            raise HTTPException(status_code=400, detail=err)
        entry_rows = paste_rows
    has_ps = body.project_slug is not None and str(body.project_slug).strip()
    has_gid = body.group_id is not None
    if not has_ps and not has_gid:
        raise HTTPException(
            status_code=400,
            detail="project_slug or group_id is required to create a bundle",
        )
    gid: int | None = None
    pname: str | None = None
    pslug: str | None = None
    if body.project_slug is not None and str(body.project_slug).strip():
        g = await get_project_by_slug_or_404(session, body.project_slug)
        gid = g.id
        pname = g.name
        pslug = g.slug
        if body.group_id is not None and body.group_id != gid:
            raise HTTPException(
                status_code=400,
                detail="project_slug does not match group_id",
            )
    elif body.group_id is not None:
        g = await get_project_or_404(session, body.group_id)
        gid = body.group_id
        pname = g.name
        pslug = g.slug
    if not can_create_bundle(
        scopes,
        bundle_name=display_name,
        bundle_slug=slug_out,
        group_id=gid,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this bundle")
    env_fk = await require_project_environment_id_for_create(
        session,
        group_id=gid,
        slug=body.project_environment_slug,
        resource="bundle",
    )
    dup_q = select(Bundle.id).where(Bundle.group_id == gid, Bundle.name == display_name)
    if env_fk is None:
        dup_q = dup_q.where(Bundle.project_environment_id.is_(None))
    else:
        dup_q = dup_q.where(Bundle.project_environment_id == env_fk)
    if (await session.execute(dup_q)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Bundle name already exists in this environment")
    dup_slug = select(Bundle.id).where(Bundle.group_id == gid, Bundle.slug == slug_out)
    if env_fk is None:
        dup_slug = dup_slug.where(Bundle.project_environment_id.is_(None))
    else:
        dup_slug = dup_slug.where(Bundle.project_environment_id == env_fk)
    if (await session.execute(dup_slug)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Bundle slug already exists in this environment")
    max_so_stmt = select(func.coalesce(func.max(Bundle.sort_order), -1)).where(Bundle.group_id == gid)
    if env_fk is None:
        max_so_stmt = max_so_stmt.where(Bundle.project_environment_id.is_(None))
    else:
        max_so_stmt = max_so_stmt.where(Bundle.project_environment_id == env_fk)
    next_sort = int((await session.execute(max_so_stmt)).scalar_one()) + 1
    b = Bundle(
        name=display_name,
        slug=slug_out,
        group_id=gid,
        project_environment_id=env_fk,
        sort_order=next_sort,
    )
    session.add(b)
    await session.flush()
    if entry_rows:
        entry_rows = dedupe_entry_rows(
            [(normalize_env_key(k), v, s) for k, v, s in entry_rows]
        )
        await bulk_upsert_bundle_secrets(session, b.id, entry_rows)
    await session.commit()
    await session.refresh(b)
    out_slug: str | None = None
    if b.group_id is not None:
        g2 = await session.get(BundleGroup, b.group_id)
        out_slug = g2.slug if g2 else None
    env_slug: str | None = None
    if b.project_environment_id is not None:
        pe = await session.get(ProjectEnvironment, b.project_environment_id)
        env_slug = pe.slug if pe else None
    return {
        "id": b.id,
        "name": b.name,
        "slug": b.slug,
        "group_id": b.group_id,
        "project_slug": out_slug,
        "project_environment_slug": env_slug,
    }


@router.patch("/bundles/{name}")
async def patch_bundle(
    name: str,
    body: PatchBundleBody,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    validate_bundle_path_segment(name)
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to patch")
    scopes = parse_scopes_json(key.scopes)
    b = await fetch_bundle_for_path(
        session,
        name,
        project_slug=scope.project_slug,
        environment_slug=scope.environment_slug,
    )
    pn = b.group.name if b.group else None
    ps = _pslug(b.group)
    if not can_write_bundle(
        scopes,
        bundle_name=b.name,
        bundle_slug=b.slug,
        group_id=b.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    if "name" in body.model_fields_set and body.name is not None:
        new_name = body.name
        validate_bundle_display_name(new_name)
        if new_name != b.name:
            dup_q = select(Bundle.id).where(
                Bundle.group_id == b.group_id,
                Bundle.name == new_name,
            )
            if b.project_environment_id is None:
                dup_q = dup_q.where(Bundle.project_environment_id.is_(None))
            else:
                dup_q = dup_q.where(Bundle.project_environment_id == b.project_environment_id)
            existing_id = (await session.execute(dup_q)).scalar_one_or_none()
            if existing_id is not None and existing_id != b.id:
                raise HTTPException(status_code=409, detail="Bundle name already exists in this environment")
            b.name = new_name
    if "slug" in body.model_fields_set and body.slug is not None:
        new_slug = body.slug
        validate_bundle_slug(new_slug)
        if new_slug != b.slug:
            dup_sq = select(Bundle.id).where(
                Bundle.group_id == b.group_id,
                Bundle.slug == new_slug,
            )
            if b.project_environment_id is None:
                dup_sq = dup_sq.where(Bundle.project_environment_id.is_(None))
            else:
                dup_sq = dup_sq.where(Bundle.project_environment_id == b.project_environment_id)
            existing_sid = (await session.execute(dup_sq)).scalar_one_or_none()
            if existing_sid is not None and existing_sid != b.id:
                raise HTTPException(status_code=409, detail="Bundle slug already exists in this environment")
            b.slug = new_slug
    prior_group_id = b.group_id
    prior_env_id = b.project_environment_id
    target_gid = b.group_id
    new_pn: str | None = pn
    new_ps: str | None = ps
    if "project_slug" in body.model_fields_set:
        if body.project_slug is None or (
            isinstance(body.project_slug, str) and not body.project_slug.strip()
        ):
            target_gid = None
            new_pn = None
            new_ps = None
        else:
            g = await get_project_by_slug_or_404(session, body.project_slug)
            target_gid = g.id
            new_pn = g.name
            new_ps = g.slug
    elif "group_id" in body.model_fields_set:
        if body.group_id is None:
            target_gid = None
            new_pn = None
            new_ps = None
        else:
            g = await get_project_or_404(session, body.group_id)
            target_gid = body.group_id
            new_pn = g.name
            new_ps = g.slug
    if target_gid != b.group_id:
        if not can_create_bundle(
            scopes,
            bundle_name=b.name,
            bundle_slug=b.slug,
            group_id=target_gid,
            project_name=new_pn,
            project_slug=new_ps,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to set this project on the bundle",
            )
    moving_project = target_gid != prior_group_id
    b.group_id = target_gid
    if moving_project and "project_environment_slug" not in body.model_fields_set:
        b.project_environment_id = None
    if "project_environment_slug" in body.model_fields_set:
        if body.project_environment_slug is None or (
            isinstance(body.project_environment_slug, str) and not str(body.project_environment_slug).strip()
        ):
            new_env_id = None
        else:
            gid_now = b.group_id
            if not gid_now:
                raise HTTPException(
                    status_code=400,
                    detail="Assign this bundle to a project before setting an environment",
                )
            new_env_id = await resolve_project_environment_fk(
                session,
                group_id=gid_now,
                slug=body.project_environment_slug,
            )
        if not moving_project and prior_env_id is not None and new_env_id != prior_env_id:
            raise HTTPException(
                status_code=400,
                detail="Environment is already assigned; it cannot be changed or cleared.",
            )
        b.project_environment_id = new_env_id
    if "entries" in body.model_fields_set and body.entries is not None:
        entry_rows, err = parse_bundle_entries_dict(body.entries)
        if err:
            raise HTTPException(status_code=400, detail=err)
        await bulk_upsert_bundle_secrets(session, b.id, entry_rows)
    await session.commit()
    await session.refresh(b)
    out_slug: str | None = None
    if b.group_id is not None:
        g2 = await session.get(BundleGroup, b.group_id)
        out_slug = g2.slug if g2 else None
    env_slug: str | None = None
    if b.project_environment_id is not None:
        pe = await session.get(ProjectEnvironment, b.project_environment_id)
        env_slug = pe.slug if pe else None
    return {
        "name": b.name,
        "slug": b.slug,
        "group_id": b.group_id,
        "project_slug": out_slug,
        "project_environment_slug": env_slug,
    }


@router.delete("/bundles/{name}", status_code=204)
async def delete_bundle(
    name: str,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_path_segment(name)
    scopes = parse_scopes_json(key.scopes)
    b = await fetch_bundle_for_path(
        session,
        name,
        project_slug=scope.project_slug,
        environment_slug=scope.environment_slug,
    )
    pn = b.group.name if b.group else None
    ps = _pslug(b.group)
    if not can_write_bundle(
        scopes,
        bundle_name=b.name,
        bundle_slug=b.slug,
        group_id=b.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    # Remove stack layers that reference this bundle so stacks stay consistent (SQLite may not
    # enforce ON DELETE CASCADE on bundle_id the same way as Postgres).
    await session.execute(delete(BundleStackLayer).where(BundleStackLayer.bundle_id == b.id))
    await session.execute(delete(Bundle).where(Bundle.id == b.id))
    await session.commit()
    return Response(status_code=204)


@router.get("/bundles/{name}")
async def get_bundle_decrypted(
    name: str,
    request: Request,
    scope: ResourcePathScope = Depends(),
    include_secret_values: bool = Query(
        False,
        description="Include plaintext for encrypted entries (default false; same idea as stack key-graph).",
    ),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict:
    scope_kw = _bundle_scope_query(scope)
    if include_secret_values:
        bundle, entries = await load_bundle_entries(session, name, **scope_kw)
    else:
        bundle, entries = await load_bundle_entries_list_masked(session, name, **scope_kw)
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    if include_secret_values:
        await emit_audit_event(
            session,
            request,
            event_type="bundle.secrets_read",
            actor=key,
            bundle_id=bundle.id,
            bundle_name=bundle.name,
            details={"include_secret_values": True},
        )
    secrets_map = {k: v[0] for k, v in entries.items()}
    secret_flags = {k: v[1] for k, v in entries.items()}
    return {
        "name": bundle.name,
        "slug": bundle.slug,
        "secrets": secrets_map,
        "secret_flags": secret_flags,
        "secret_values_included": include_secret_values,
        "group_id": bundle.group_id,
        "project_name": bundle.group.name if bundle.group else None,
        "project_slug": pslug,
        "project_environment_slug": (
            bundle.project_environment.slug if bundle.project_environment else None
        ),
    }


@router.get("/bundles/{name}/key-names")
async def get_bundle_key_names(
    name: str,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, list[str]]:
    """Sorted key names from bundle secrets (not sealed secrets); for stack layer UI and automation."""
    validate_bundle_path_segment(name)
    bundle = await fetch_bundle_for_path(
        session,
        name,
        project_slug=scope.project_slug,
        environment_slug=scope.environment_slug,
    )
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    keys = await list_bundle_secret_key_names(session, name, **_bundle_scope_query(scope))
    return {"keys": keys}


@router.get("/bundles/{name}/export")
@limiter.limit("120/minute")
async def export_bundle(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    format: Literal["dotenv", "json"] = Query("dotenv"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, secrets_map = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await emit_audit_event(
        session,
        request,
        event_type="bundle.export",
        actor=key,
        bundle_id=bundle.id,
        bundle_name=bundle.name,
        details={"format": format},
    )
    if format == "json":
        body = json.dumps(secrets_map, sort_keys=True, indent=2) + "\n"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{name}.json"'},
        )
    text = format_secrets_dotenv(secrets_map)
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.env"'},
    )


@router.get("/bundles/{name}/backup")
async def export_bundle_backup_json(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Structured JSON backup for merge import (includes format id)."""
    validate_bundle_path_segment(name)
    bundle, entries = await load_bundle_entries(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await emit_audit_event(
        session,
        request,
        event_type="bundle.backup_json",
        actor=key,
        bundle_id=bundle.id,
        bundle_name=bundle.name,
        details={},
    )
    secrets_map = {k: v[0] for k, v in entries.items()}
    secret_flags = {k: v[1] for k, v in entries.items()}
    return {
        "format": BUNDLE_BACKUP_FORMAT,
        "bundle": bundle.name,
        "secrets": secrets_map,
        "secret_flags": secret_flags,
        "group_id": bundle.group_id,
        "project_name": pn,
        "project_slug": pslug,
    }


@router.post("/bundles/{name}/backup/encrypted")
@limiter.limit("120/hour")
async def export_bundle_backup_encrypted(
    request: Request,
    name: str,
    body: BundlePassphraseBody,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_path_segment(name)
    bundle, entries = await load_bundle_entries(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await emit_audit_event(
        session,
        request,
        event_type="bundle.backup_encrypted",
        actor=key,
        bundle_id=bundle.id,
        bundle_name=bundle.name,
        details={},
    )
    payload = {
        "format": BUNDLE_BACKUP_FORMAT,
        "bundle": bundle.name,
        "secrets": {k: v[0] for k, v in entries.items()},
        "secret_flags": {k: v[1] for k, v in entries.items()},
        "group_id": bundle.group_id,
        "project_name": pn,
        "project_slug": pslug,
    }
    raw = json.dumps(payload, sort_keys=True, indent=2).encode("utf-8")
    try:
        enc = await encrypt_bytes_async(raw, body.passphrase)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    safe = name.replace("/", "-")[:200]
    fn = f"{safe}.envelope-bundle"
    return Response(
        content=enc,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{fn}"',
            "Content-Length": str(len(enc)),
        },
    )


async def _import_bundle_backup_merge_core(
    name: str,
    body: BundleBackupPayloadV1,
    auth: ApiKey,
    session: AsyncSession,
    scope: ResourcePathScope,
) -> dict[str, str | int]:
    validate_bundle_path_segment(name)
    if body.format != BUNDLE_BACKUP_FORMAT:
        raise HTTPException(status_code=400, detail="unsupported backup format")
    if body.bundle.strip() != name.strip():
        raise HTTPException(status_code=400, detail="backup bundle name does not match path")
    bundle, _ = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    flags = body.secret_flags or {}
    rows: list[tuple[str, str, bool]] = []
    for k, val in body.secrets.items():
        nk = normalize_env_key(k)
        if not nk:
            continue
        if k in flags:
            is_sec = bool(flags[k])
        elif nk in flags:
            is_sec = bool(flags[nk])
        else:
            is_sec = True
        rows.append((nk, coerce_value_to_string(val), is_sec))
    rows = dedupe_entry_rows(rows)
    if not rows:
        return {"status": "ok", "updated": 0}
    await bulk_upsert_bundle_secrets(session, bundle.id, rows)
    await session.commit()
    return {"status": "ok", "updated": len(rows)}


@router.put("/bundles/{name}/backup")
async def import_bundle_backup_merge(
    name: str,
    body: BundleBackupPayloadV1,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int]:
    """Merge secrets from a v1 JSON backup into the named bundle (upsert keys)."""
    return await _import_bundle_backup_merge_core(name, body, auth, session, scope)


@router.post("/bundles/{name}/backup/import-encrypted", response_model=None)
@limiter.limit("30/hour")
async def import_bundle_backup_encrypted(
    request: Request,
    name: str,
    file: UploadFile = File(...),
    passphrase: str = Form(...),
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int]:
    validate_bundle_path_segment(name)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        plain = decrypt_bytes(raw, passphrase.strip())
    except WrongPassphraseError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        data = json.loads(plain.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail="invalid JSON after decrypt") from e
    try:
        payload = BundleBackupPayloadV1.model_validate(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid backup payload: {e}") from e
    return await _import_bundle_backup_merge_core(name, payload, auth, session, scope)


@router.post("/bundles/{name}/secrets", status_code=204)
async def upsert_secret(
    name: str,
    body: UpsertSecretBody,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    key_name = body.key_name.strip()
    if not key_name:
        raise HTTPException(status_code=400, detail="key_name required")
    fernet = get_fernet()
    stored = encode_stored_value(fernet, body.value, body.is_secret)
    r = await session.execute(
        select(Secret).where(Secret.bundle_id == bundle.id, Secret.key_name == key_name)
    )
    row = r.scalar_one_or_none()
    if row:
        row.value_ciphertext = stored
        row.is_secret = body.is_secret
    else:
        session.add(
            Secret(
                bundle_id=bundle.id,
                key_name=key_name,
                value_ciphertext=stored,
                is_secret=body.is_secret,
            )
        )
    await session.commit()
    return Response(status_code=204)


@router.post("/bundles/{name}/secrets/encrypt", status_code=204)
async def encrypt_plain_secret(
    name: str,
    key_name: str = Query(..., min_length=1, max_length=512),
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await encrypt_plain_entry(session, bundle.id, key_name)
    await session.commit()
    return Response(status_code=204)


@router.post("/bundles/{name}/secrets/declassify", status_code=204)
async def declassify_encrypted_secret(
    name: str,
    key_name: str = Query(..., min_length=1, max_length=512),
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await declassify_secret_entry(session, bundle.id, key_name)
    await session.commit()
    return Response(status_code=204)


@router.delete("/bundles/{name}/secrets", status_code=204)
async def delete_secret(
    name: str,
    key_name: str = Query(..., min_length=1, max_length=512),
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    r = await session.execute(
        delete(Secret).where(Secret.bundle_id == bundle.id, Secret.key_name == key_name)
    )
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Secret not found")
    await session.commit()
    return Response(status_code=204)


@router.get("/bundles/{name}/env-links")
@limiter.limit("60/minute")
async def list_bundle_env_links(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, int | str]]:
    """List opaque env links: id, created time, and ``token_sha256`` (SHA-256 hex of the path token).

    The raw URL segment is never stored; compare hashes to pick ``id`` for ``DELETE``.
    """
    validate_bundle_path_segment(name)
    bundle, _ = await load_bundle_entries(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(
            status_code=403, detail="Insufficient scope to manage env links for this bundle"
        )
    r = await session.execute(
        select(BundleEnvLink.id, BundleEnvLink.created_at, BundleEnvLink.token_sha256)
        .where(BundleEnvLink.bundle_id == bundle.id)
        .order_by(BundleEnvLink.created_at.desc())
    )
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat(),
            "token_sha256": row.token_sha256,
        }
        for row in r.all()
    ]


@router.post("/bundles/{name}/env-links", status_code=201)
@limiter.limit("30/minute")
async def create_bundle_env_link(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Create an opaque URL (no project/bundle names) that downloads this bundle as .env or JSON."""
    validate_bundle_path_segment(name)
    bundle, _ = await load_bundle_entries(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to manage env links for this bundle")
    raw, digest = new_env_link_token()
    session.add(BundleEnvLink(bundle_id=bundle.id, token_sha256=digest))
    await session.commit()
    base = str(request.base_url).rstrip("/")
    return {
        "url": f"{base}/env/{raw}",
        "message": "Save this URL; the secret path is not stored and cannot be shown again.",
    }


@router.delete("/bundles/{name}/env-links/{link_id}", status_code=204)
async def delete_bundle_env_link(
    name: str,
    link_id: int,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_path_segment(name)
    bundle, _ = await load_bundle_entries(session, name, **_bundle_scope_query(scope))
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to manage env links for this bundle")
    r = await session.execute(
        delete(BundleEnvLink).where(
            BundleEnvLink.id == link_id,
            BundleEnvLink.bundle_id == bundle.id,
        )
    )
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Env link not found")
    await session.commit()
    return Response(status_code=204)
