import json
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from app.api.resource_scope import ResourcePathScope
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key
from app.limiter import limiter
from app.models import ApiKey, BundleGroup, BundleStack, BundleStackLayer, ProjectEnvironment, StackEnvLink
from app.services.bundles import format_secrets_dotenv
from app.services.env_links import new_env_link_token
from app.services.project_environments import (
    UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL,
    get_project_environment_by_group_and_slug,
    require_project_environment_id_for_create,
    resolve_project_environment_fk,
)
from app.services.projects import get_project_by_slug_or_404, get_project_or_404
from app.services.scopes import (
    can_create_stack,
    can_read_bundle,
    can_read_stack,
    can_write_stack,
    parse_scopes_json,
    scopes_allow_admin,
)
from app.services.stacks import (
    LayerSpec,
    get_stack_by_name,
    load_stack_secrets,
    normalize_layer_aliases_map,
    replace_stack_layers,
    stack_key_graph_payload_for_stack,
    stack_slug_suggestion_from_display_name,
    validate_stack_display_name,
    validate_stack_path_segment,
    validate_stack_slug,
    validate_through_layer_position,
)

router = APIRouter()


class StackEnvLinkCreateIn(BaseModel):
    """Optional JSON body for ``POST /stacks/{name}/env-links``."""

    through_layer_position: int | None = None


def _pslug(group: BundleGroup | None) -> str | None:
    return group.slug if group else None


class StackLayerIn(BaseModel):
    """One stack layer: a bundle plus all keys (*) or an explicit subset."""

    bundle: str = Field(..., min_length=1, max_length=256)
    keys: Literal["*"] | list[str] = "*"
    label: str | None = None
    # Export additional names copying values from keys already present in merged layers below.
    aliases: dict[str, str] | None = None

    @field_validator("bundle")
    @classmethod
    def strip_bundle(cls, v: str) -> str:
        return v.strip()

    @field_validator("label")
    @classmethod
    def strip_label(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > 256:
            raise ValueError("label must be at most 256 characters")
        return s

    @field_validator("keys")
    @classmethod
    def validate_keys(cls, v: Literal["*"] | list[str]) -> Literal["*"] | list[str]:
        if isinstance(v, list):
            if len(v) == 0:
                raise ValueError('use "*" for all keys or a non-empty list of key names')
            seen: set[str] = set()
            out: list[str] = []
            for x in v:
                s = str(x).strip()
                if not s or s in seen:
                    continue
                seen.add(s)
                out.append(s)
            if not out:
                raise ValueError("no valid key names after trim/dedupe")
            return out
        return v

    @field_validator("aliases")
    @classmethod
    def validate_aliases(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        try:
            return normalize_layer_aliases_map(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


def _coerce_legacy_string_layers(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    layers = data.get("layers")
    if isinstance(layers, list) and layers and isinstance(layers[0], str):
        return {**data, "layers": [{"bundle": s, "keys": "*"} for s in layers]}
    return data


class CreateStackBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    """URL segment (optional; derived from name when omitted)."""
    slug: str | None = Field(None, max_length=128)
    layers: list[StackLayerIn] = Field(..., min_length=1)
    group_id: int | None = None
    project_slug: str | None = None
    project_environment_slug: str | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy(cls, data: Any) -> Any:
        return _coerce_legacy_string_layers(data)


class PatchStackBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    layers: list[StackLayerIn] | None = None
    group_id: int | None = None
    project_slug: str | None = None
    project_environment_slug: str | None = None

    @field_validator("name")
    @classmethod
    def strip_stack_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip()

    @field_validator("slug")
    @classmethod
    def strip_stack_slug(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip()

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy(cls, data: Any) -> Any:
        return _coerce_legacy_string_layers(data)


def _stack_layers_to_specs(layers: list[StackLayerIn]) -> list[LayerSpec]:
    out: list[LayerSpec] = []
    for L in layers:
        al = L.aliases
        if L.keys == "*":
            out.append(LayerSpec(L.bundle, None, L.label, al))
        else:
            out.append(LayerSpec(L.bundle, L.keys, L.label, al))
    return out


def _serialize_stack_layer(layer: BundleStackLayer) -> dict[str, Any]:
    b = layer.bundle
    bref = (getattr(b, "slug", None) or "").strip() or b.name
    if getattr(layer, "keys_mode", "all") != "pick" or not layer.selected_keys_json:
        d: dict[str, Any] = {"bundle": bref, "keys": "*"}
    else:
        d = {"bundle": bref, "keys": json.loads(layer.selected_keys_json)}
    raw = getattr(layer, "layer_label", None)
    if isinstance(raw, str) and raw.strip():
        d["label"] = raw.strip()
    aj = getattr(layer, "aliases_json", None)
    if isinstance(aj, str) and aj.strip():
        try:
            parsed = json.loads(aj)
            if isinstance(parsed, dict) and parsed:
                d["aliases"] = parsed
        except json.JSONDecodeError:
            pass
    return d


def _stack_scope_query(scope: ResourcePathScope) -> dict[str, str | None]:
    return {"project_slug": scope.project_slug, "environment_slug": scope.environment_slug}


async def _load_stack_for_api(
    session: AsyncSession, name: str, scope: ResourcePathScope
) -> BundleStack:
    st = await get_stack_by_name(
        session,
        name,
        **_stack_scope_query(scope),
    )
    if st is None:
        raise HTTPException(status_code=404, detail="Stack not found")
    return st


async def _ensure_can_export_stack(
    session: AsyncSession,
    stack: BundleStack,
    scopes: list[str],
) -> None:
    pn = stack.group.name if stack.group else None
    pslug = _pslug(stack.group)
    if not can_read_stack(
        scopes,
        stack_name=stack.name,
        stack_slug=stack.slug,
        group_id=stack.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    layers = sorted(stack.layers, key=lambda L: L.position)
    for layer in layers:
        b = layer.bundle
        pn_b = b.group.name if b.group else None
        ps_b = _pslug(b.group)
        if not can_read_bundle(
            scopes,
            bundle_name=b.name,
            bundle_slug=b.slug,
            group_id=b.group_id,
            project_name=pn_b,
            project_slug=ps_b,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to read a bundle in this stack",
            )


def _stack_list_row(s: BundleStack) -> dict[str, str | None]:
    pe = s.project_environment
    return {
        "name": s.name,
        "slug": s.slug,
        "project_environment_slug": pe.slug if pe else None,
        "project_environment_name": pe.name if pe else None,
    }


@router.get("/stacks")
async def list_stacks(
    project_slug: str | None = Query(None, description="If set, only stacks in this project"),
    environment_slug: str | None = Query(
        None,
        description="With project_slug: filter by project environment slug.",
    ),
    include_unassigned: bool = Query(
        False,
        description="Deprecated; ignored. Stacks must belong to an environment.",
    ),
    with_environment: bool = Query(
        False,
        description="If true (requires project_slug), return name + environment fields per row.",
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
    q = select(BundleStack).options(
        selectinload(BundleStack.group),
        selectinload(BundleStack.project_environment),
    ).order_by(BundleStack.name)
    if project_slug is not None and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        q = q.where(BundleStack.group_id == g.id)
        if environment_slug is not None and str(environment_slug).strip():
            raw = str(environment_slug).strip()
            if raw == UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL:
                raise HTTPException(
                    status_code=400,
                    detail="environment_slug must be a real environment, not the legacy unassigned sentinel.",
                )
            env = await get_project_environment_by_group_and_slug(session, group_id=g.id, slug=raw)
            q = q.where(BundleStack.project_environment_id == env.id)
    r = await session.execute(q)
    rows = r.scalars().all()
    if scopes_allow_admin(scopes):
        if with_environment and has_ps:
            return [_stack_list_row(s) for s in rows]
        return [s.slug for s in rows]
    out_str: list[str] = []
    out_detail: list[dict[str, str | None]] = []
    for s in rows:
        pn = s.group.name if s.group else None
        ps = _pslug(s.group)
        if can_read_stack(
            scopes,
            stack_name=s.name,
            stack_slug=s.slug,
            group_id=s.group_id,
            project_name=pn,
            project_slug=ps,
        ):
            if with_environment and has_ps:
                out_detail.append(_stack_list_row(s))
            else:
                out_str.append(s.slug)
    return out_detail if (with_environment and has_ps) else out_str


@router.post("/stacks", status_code=201)
async def create_stack(
    body: CreateStackBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    display_name = body.name.strip()
    validate_stack_display_name(display_name)
    slug_raw = (body.slug or "").strip()
    slug_out = slug_raw or stack_slug_suggestion_from_display_name(display_name)
    validate_stack_slug(slug_out)
    scopes = parse_scopes_json(key.scopes)
    has_ps = body.project_slug is not None and str(body.project_slug).strip()
    has_gid = body.group_id is not None
    if not has_ps and not has_gid:
        raise HTTPException(
            status_code=400,
            detail="project_slug or group_id is required to create a stack",
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
    if not can_create_stack(
        scopes,
        stack_name=display_name,
        stack_slug=slug_out,
        group_id=gid,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this stack")
    env_fk = await require_project_environment_id_for_create(
        session,
        group_id=gid,
        slug=body.project_environment_slug,
        resource="stack",
    )
    dup_q = select(BundleStack.id).where(BundleStack.group_id == gid, BundleStack.name == display_name)
    if env_fk is None:
        dup_q = dup_q.where(BundleStack.project_environment_id.is_(None))
    else:
        dup_q = dup_q.where(BundleStack.project_environment_id == env_fk)
    if (await session.execute(dup_q)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Stack name already exists in this environment")
    dup_slug = select(BundleStack.id).where(BundleStack.group_id == gid, BundleStack.slug == slug_out)
    if env_fk is None:
        dup_slug = dup_slug.where(BundleStack.project_environment_id.is_(None))
    else:
        dup_slug = dup_slug.where(BundleStack.project_environment_id == env_fk)
    if (await session.execute(dup_slug)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Stack slug already exists in this environment")
    st = BundleStack(name=display_name, slug=slug_out, group_id=gid, project_environment_id=env_fk)
    session.add(st)
    await session.flush()
    await replace_stack_layers(session, st.id, _stack_layers_to_specs(body.layers))
    await session.commit()
    await session.refresh(st)
    out_slug: str | None = None
    if st.group_id is not None:
        g2 = await session.get(BundleGroup, st.group_id)
        out_slug = g2.slug if g2 else None
    env_slug: str | None = None
    if st.project_environment_id is not None:
        pe = await session.get(ProjectEnvironment, st.project_environment_id)
        env_slug = pe.slug if pe else None
    return {
        "id": st.id,
        "name": st.name,
        "slug": st.slug,
        "group_id": st.group_id,
        "project_slug": out_slug,
        "project_environment_slug": env_slug,
    }


@router.get("/stacks/{name}")
async def get_stack(
    name: str,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    validate_stack_path_segment(name)
    st = await _load_stack_for_api(session, name, scope)
    scopes = parse_scopes_json(key.scopes)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_read_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    layers = sorted(st.layers, key=lambda L: L.position)
    layer_payload = [_serialize_stack_layer(layer) for layer in layers]
    out_slug: str | None = None
    if st.group_id is not None:
        g2 = await session.get(BundleGroup, st.group_id)
        out_slug = g2.slug if g2 else None
    env_slug: str | None = None
    if st.project_environment_id is not None:
        pe = await session.get(ProjectEnvironment, st.project_environment_id)
        env_slug = pe.slug if pe else None
    return {
        "name": st.name,
        "slug": st.slug,
        "group_id": st.group_id,
        "project_slug": out_slug,
        "project_environment_slug": env_slug,
        "layers": layer_payload,
    }


@router.get("/stacks/{name}/key-graph")
async def get_stack_key_graph(
    name: str,
    scope: ResourcePathScope = Depends(),
    include_secret_values: bool = Query(
        False,
        description="Include plaintext for secret keys (default false).",
    ),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Merged key graph for stack layers (same payload as legacy web `/key-graph/data`)."""
    validate_stack_path_segment(name)
    st = await _load_stack_for_api(session, name, scope)
    scopes = parse_scopes_json(key.scopes)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_read_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    return await stack_key_graph_payload_for_stack(
        session, st, include_secret_values=include_secret_values
    )


@router.patch("/stacks/{name}")
async def patch_stack(
    name: str,
    body: PatchStackBody,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    validate_stack_path_segment(name)
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to patch")
    scopes = parse_scopes_json(key.scopes)
    st = await _load_stack_for_api(session, name, scope)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    if "name" in body.model_fields_set and body.name is not None:
        new_name = body.name
        validate_stack_display_name(new_name)
        if new_name != st.name:
            dup_q = select(BundleStack.id).where(
                BundleStack.group_id == st.group_id,
                BundleStack.name == new_name,
            )
            if st.project_environment_id is None:
                dup_q = dup_q.where(BundleStack.project_environment_id.is_(None))
            else:
                dup_q = dup_q.where(BundleStack.project_environment_id == st.project_environment_id)
            existing_id = (await session.execute(dup_q)).scalar_one_or_none()
            if existing_id is not None and existing_id != st.id:
                raise HTTPException(status_code=409, detail="Stack name already exists in this environment")
            st.name = new_name
    if "slug" in body.model_fields_set and body.slug is not None:
        new_slug = body.slug
        validate_stack_slug(new_slug)
        if new_slug != st.slug:
            dup_sq = select(BundleStack.id).where(
                BundleStack.group_id == st.group_id,
                BundleStack.slug == new_slug,
            )
            if st.project_environment_id is None:
                dup_sq = dup_sq.where(BundleStack.project_environment_id.is_(None))
            else:
                dup_sq = dup_sq.where(BundleStack.project_environment_id == st.project_environment_id)
            existing_sid = (await session.execute(dup_sq)).scalar_one_or_none()
            if existing_sid is not None and existing_sid != st.id:
                raise HTTPException(status_code=409, detail="Stack slug already exists in this environment")
            st.slug = new_slug
    prior_group_id = st.group_id
    prior_env_id = st.project_environment_id
    target_gid = st.group_id
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
    if target_gid != st.group_id:
        if not can_create_stack(
            scopes,
            stack_name=st.name,
            stack_slug=st.slug,
            group_id=target_gid,
            project_name=new_pn,
            project_slug=new_ps,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to set this project on the stack",
            )
    moving_project = target_gid != prior_group_id
    st.group_id = target_gid
    if moving_project and "project_environment_slug" not in body.model_fields_set:
        st.project_environment_id = None
    if "project_environment_slug" in body.model_fields_set:
        if body.project_environment_slug is None or (
            isinstance(body.project_environment_slug, str)
            and not str(body.project_environment_slug).strip()
        ):
            new_env_id = None
        else:
            gid_now = st.group_id
            if not gid_now:
                raise HTTPException(
                    status_code=400,
                    detail="Assign this stack to a project before setting an environment",
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
        st.project_environment_id = new_env_id
    if "layers" in body.model_fields_set and body.layers is not None:
        if len(body.layers) == 0:
            raise HTTPException(status_code=400, detail="layers must not be empty")
        await replace_stack_layers(session, st.id, _stack_layers_to_specs(body.layers))
    await session.commit()
    await session.refresh(st)
    out_slug: str | None = None
    if st.group_id is not None:
        g2 = await session.get(BundleGroup, st.group_id)
        out_slug = g2.slug if g2 else None
    env_slug: str | None = None
    if st.project_environment_id is not None:
        pe = await session.get(ProjectEnvironment, st.project_environment_id)
        env_slug = pe.slug if pe else None
    return {
        "name": st.name,
        "slug": st.slug,
        "group_id": st.group_id,
        "project_slug": out_slug,
        "project_environment_slug": env_slug,
    }


@router.delete("/stacks/{name}", status_code=204)
async def delete_stack(
    name: str,
    scope: ResourcePathScope = Depends(),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_path_segment(name)
    scopes = parse_scopes_json(key.scopes)
    st = await _load_stack_for_api(session, name, scope)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    await session.execute(delete(BundleStack).where(BundleStack.id == st.id))
    await session.commit()
    return Response(status_code=204)


@router.get("/stacks/{name}/export")
@limiter.limit("120/minute")
async def export_stack(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    format: Literal["dotenv", "json"] = Query("dotenv"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_path_segment(name)
    st = await get_stack_by_name(session, name, **_stack_scope_query(scope))
    if st is None:
        raise HTTPException(status_code=404, detail="Stack not found")
    scopes = parse_scopes_json(key.scopes)
    await _ensure_can_export_stack(session, st, scopes)
    secrets_map = await load_stack_secrets(session, st)
    safe_fn = st.slug or name
    if format == "json":
        body = json.dumps(secrets_map, sort_keys=True, indent=2) + "\n"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_fn}.json"'},
        )
    text = format_secrets_dotenv(secrets_map)
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_fn}.env"'},
    )


@router.get("/stacks/{name}/env-links")
@limiter.limit("60/minute")
async def list_stack_env_links(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, int | str | None]]:
    validate_stack_path_segment(name)
    st = await _load_stack_for_api(session, name, scope)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(
            status_code=403, detail="Insufficient scope to manage env links for this stack"
        )
    layers_sorted = sorted(st.layers, key=lambda L: L.position)
    pos_to_bundle = {L.position: L.bundle.name for L in layers_sorted}
    r = await session.execute(
        select(
            StackEnvLink.id,
            StackEnvLink.created_at,
            StackEnvLink.through_layer_position,
            StackEnvLink.token_sha256,
        )
        .where(StackEnvLink.stack_id == st.id)
        .order_by(StackEnvLink.created_at.desc())
    )
    out: list[dict[str, int | str | None]] = []
    for row in r.all():
        tpl = row.through_layer_position
        slice_label: str | None = None
        if tpl is not None:
            slice_label = pos_to_bundle.get(tpl)
        out.append(
            {
                "id": row.id,
                "created_at": row.created_at.isoformat(),
                "through_layer_position": tpl,
                "slice_label": slice_label,
                "token_sha256": row.token_sha256,
            }
        )
    return out


@router.post("/stacks/{name}/env-links", status_code=201)
@limiter.limit("30/minute")
async def create_stack_env_link(
    request: Request,
    name: str,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
    body: StackEnvLinkCreateIn = Body(default_factory=StackEnvLinkCreateIn),
) -> dict[str, str]:
    validate_stack_path_segment(name)
    st = await _load_stack_for_api(session, name, scope)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(
            status_code=403, detail="Insufficient scope to manage env links for this stack"
        )
    tpl = validate_through_layer_position(st, body.through_layer_position)
    raw, digest = new_env_link_token()
    session.add(
        StackEnvLink(
            stack_id=st.id,
            token_sha256=digest,
            through_layer_position=tpl,
        )
    )
    await session.commit()
    base = str(request.base_url).rstrip("/")
    return {
        "url": f"{base}/env/{raw}",
        "message": "Save this URL; the secret path is not stored and cannot be shown again.",
    }


@router.delete("/stacks/{name}/env-links/{link_id}", status_code=204)
async def delete_stack_env_link(
    name: str,
    link_id: int,
    scope: ResourcePathScope = Depends(),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_path_segment(name)
    st = await _load_stack_for_api(session, name, scope)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        stack_slug=st.slug,
        group_id=st.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(
            status_code=403, detail="Insufficient scope to manage env links for this stack"
        )
    r = await session.execute(
        delete(StackEnvLink).where(
            StackEnvLink.id == link_id,
            StackEnvLink.stack_id == st.id,
        )
    )
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Env link not found")
    await session.commit()
    return Response(status_code=204)
