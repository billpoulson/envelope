import json
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key
from app.limiter import limiter
from app.models import ApiKey, BundleGroup, BundleStack, BundleStackLayer, StackEnvLink
from app.services.bundles import format_secrets_dotenv
from app.services.env_links import new_env_link_token
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
    replace_stack_layers,
    stack_key_graph_payload_for_stack,
    validate_stack_name,
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


def _coerce_legacy_string_layers(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    layers = data.get("layers")
    if isinstance(layers, list) and layers and isinstance(layers[0], str):
        return {**data, "layers": [{"bundle": s, "keys": "*"} for s in layers]}
    return data


class CreateStackBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    layers: list[StackLayerIn] = Field(..., min_length=1)
    group_id: int | None = None
    project_slug: str | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy(cls, data: Any) -> Any:
        return _coerce_legacy_string_layers(data)


class PatchStackBody(BaseModel):
    name: str | None = None
    layers: list[StackLayerIn] | None = None
    group_id: int | None = None
    project_slug: str | None = None

    @field_validator("name")
    @classmethod
    def strip_stack_name(cls, v: str | None) -> str | None:
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
        if L.keys == "*":
            out.append(LayerSpec(L.bundle, None, L.label))
        else:
            out.append(LayerSpec(L.bundle, L.keys, L.label))
    return out


def _serialize_stack_layer(layer: BundleStackLayer) -> dict[str, Any]:
    if getattr(layer, "keys_mode", "all") != "pick" or not layer.selected_keys_json:
        d: dict[str, Any] = {"bundle": layer.bundle.name, "keys": "*"}
    else:
        d = {"bundle": layer.bundle.name, "keys": json.loads(layer.selected_keys_json)}
    raw = getattr(layer, "layer_label", None)
    if isinstance(raw, str) and raw.strip():
        d["label"] = raw.strip()
    return d


async def _load_stack_for_api(session: AsyncSession, name: str) -> BundleStack:
    st = await get_stack_by_name(session, name)
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
            group_id=b.group_id,
            project_name=pn_b,
            project_slug=ps_b,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to read a bundle in this stack",
            )


@router.get("/stacks", response_model=list[str])
async def list_stacks(
    project_slug: str | None = Query(None, description="If set, only stacks in this project"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[str]:
    scopes = parse_scopes_json(key.scopes)
    q = select(BundleStack).options(selectinload(BundleStack.group)).order_by(BundleStack.name)
    if project_slug is not None and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        q = q.where(BundleStack.group_id == g.id)
    r = await session.execute(q)
    rows = r.scalars().all()
    if scopes_allow_admin(scopes):
        return [s.name for s in rows]
    out: list[str] = []
    for s in rows:
        pn = s.group.name if s.group else None
        ps = _pslug(s.group)
        if can_read_stack(
            scopes,
            stack_name=s.name,
            group_id=s.group_id,
            project_name=pn,
            project_slug=ps,
        ):
            out.append(s.name)
    return out


@router.post("/stacks", status_code=201)
async def create_stack(
    body: CreateStackBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    name = body.name.strip()
    validate_stack_name(name)
    scopes = parse_scopes_json(key.scopes)
    existing = await session.execute(select(BundleStack.id).where(BundleStack.name == name))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Stack already exists")
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
        stack_name=name,
        group_id=gid,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this stack")
    st = BundleStack(name=name, group_id=gid)
    session.add(st)
    await session.flush()
    await replace_stack_layers(session, st.id, _stack_layers_to_specs(body.layers))
    await session.commit()
    await session.refresh(st)
    out_slug: str | None = None
    if st.group_id is not None:
        g2 = await session.get(BundleGroup, st.group_id)
        out_slug = g2.slug if g2 else None
    return {"id": st.id, "name": st.name, "group_id": st.group_id, "project_slug": out_slug}


@router.get("/stacks/{name}")
async def get_stack(
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    validate_stack_name(name)
    st = await _load_stack_for_api(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_read_stack(
        scopes,
        stack_name=st.name,
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
    return {
        "name": st.name,
        "group_id": st.group_id,
        "project_slug": out_slug,
        "layers": layer_payload,
    }


@router.get("/stacks/{name}/key-graph")
async def get_stack_key_graph(
    name: str,
    include_secret_values: bool = Query(
        False,
        description="Include plaintext for secret keys (default false).",
    ),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Merged key graph for stack layers (same payload as legacy web `/key-graph/data`)."""
    validate_stack_name(name)
    st = await _load_stack_for_api(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_read_stack(
        scopes,
        stack_name=st.name,
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
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    validate_stack_name(name)
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to patch")
    scopes = parse_scopes_json(key.scopes)
    st = await _load_stack_for_api(session, name)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
        group_id=st.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")
    if "name" in body.model_fields_set and body.name is not None:
        new_name = body.name
        validate_stack_name(new_name)
        if new_name != st.name:
            dup = await session.execute(
                select(BundleStack.id).where(BundleStack.name == new_name)
            )
            existing_id = dup.scalar_one_or_none()
            if existing_id is not None and existing_id != st.id:
                raise HTTPException(status_code=409, detail="Stack already exists")
            st.name = new_name
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
            group_id=target_gid,
            project_name=new_pn,
            project_slug=new_ps,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to set this project on the stack",
            )
    st.group_id = target_gid
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
    return {"name": st.name, "group_id": st.group_id, "project_slug": out_slug}


@router.delete("/stacks/{name}", status_code=204)
async def delete_stack(
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_name(name)
    scopes = parse_scopes_json(key.scopes)
    st = await _load_stack_for_api(session, name)
    pn = st.group.name if st.group else None
    ps = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
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
    format: Literal["dotenv", "json"] = Query("dotenv"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_name(name)
    st = await get_stack_by_name(session, name)
    if st is None:
        raise HTTPException(status_code=404, detail="Stack not found")
    scopes = parse_scopes_json(key.scopes)
    await _ensure_can_export_stack(session, st, scopes)
    secrets_map = await load_stack_secrets(session, st)
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


@router.get("/stacks/{name}/env-links")
@limiter.limit("60/minute")
async def list_stack_env_links(
    request: Request,
    name: str,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, int | str | None]]:
    validate_stack_name(name)
    st = await _load_stack_for_api(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
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
            }
        )
    return out


@router.post("/stacks/{name}/env-links", status_code=201)
@limiter.limit("30/minute")
async def create_stack_env_link(
    request: Request,
    name: str,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
    body: StackEnvLinkCreateIn = Body(default_factory=StackEnvLinkCreateIn),
) -> dict[str, str]:
    validate_stack_name(name)
    st = await _load_stack_for_api(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
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
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_stack_name(name)
    st = await _load_stack_for_api(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = st.group.name if st.group else None
    pslug = _pslug(st.group)
    if not can_write_stack(
        scopes,
        stack_name=st.name,
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
