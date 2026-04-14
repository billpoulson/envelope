import json
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_api_key, get_fernet
from app.limiter import limiter
from app.models import ApiKey, Bundle, BundleEnvLink, BundleGroup, Secret
from app.services.projects import get_project_by_slug_or_404, get_project_or_404
from app.services.scopes import (
    can_create_bundle,
    can_read_bundle,
    can_write_bundle,
    parse_scopes_json,
    scopes_allow_admin,
)
from app.services.backup_crypto import (
    WrongPassphraseError,
    decrypt_bytes,
    encrypt_bytes_async,
)
from app.services.bundles import (
    IMPORT_KIND_VALUES,
    ImportKind,
    bulk_upsert_bundle_secrets,
    coerce_value_to_string,
    dedupe_entry_rows,
    encode_stored_value,
    declassify_secret_entry,
    encrypt_plain_entry,
    format_secrets_dotenv,
    list_bundle_secret_key_names,
    load_bundle_entries,
    load_bundle_secrets,
    normalize_env_key,
    parse_bundle_entries_dict,
    parse_bundle_initial_paste,
    validate_bundle_name,
)
from app.services.env_links import new_env_link_token

router = APIRouter()

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


class PatchBundleBody(BaseModel):
    group_id: int | None = None
    project_slug: str | None = None
    # Same shape as POST /bundles `entries`: strings default to secret; use
    # {"KEY": {"value": "x", "secret": false}} or `_plaintext_keys` for plain rows.
    entries: dict[str, Any] | None = None


class UpsertSecretBody(BaseModel):
    key_name: str = Field(..., min_length=1, max_length=512)
    value: str
    is_secret: bool = True


def _pslug(group: BundleGroup | None) -> str | None:
    return group.slug if group else None


@router.get("/bundles", response_model=list[str])
async def list_bundles(
    project_slug: str | None = Query(None, description="If set, only bundles in this project"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[str]:
    scopes = parse_scopes_json(key.scopes)
    q = select(Bundle).options(selectinload(Bundle.group)).order_by(Bundle.name)
    if project_slug is not None and str(project_slug).strip():
        g = await get_project_by_slug_or_404(session, project_slug.strip())
        q = q.where(Bundle.group_id == g.id)
    r = await session.execute(q)
    rows = r.scalars().all()
    if scopes_allow_admin(scopes):
        return [b.name for b in rows]
    out: list[str] = []
    for b in rows:
        pn = b.group.name if b.group else None
        ps = _pslug(b.group)
        if can_read_bundle(
            scopes,
            bundle_name=b.name,
            group_id=b.group_id,
            project_name=pn,
            project_slug=ps,
        ) or can_write_bundle(
            scopes,
            bundle_name=b.name,
            group_id=b.group_id,
            project_name=pn,
            project_slug=ps,
        ):
            out.append(b.name)
    return out


@router.post("/bundles", status_code=201)
async def create_bundle(
    body: CreateBundleBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    name = body.name.strip()
    validate_bundle_name(name)
    scopes = parse_scopes_json(key.scopes)
    existing = await session.execute(select(Bundle.id).where(Bundle.name == name))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Bundle already exists")
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
        bundle_name=name,
        group_id=gid,
        project_name=pname,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this bundle")
    b = Bundle(name=name, group_id=gid)
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
    return {"id": b.id, "name": b.name, "group_id": b.group_id, "project_slug": out_slug}


@router.patch("/bundles/{name}")
async def patch_bundle(
    name: str,
    body: PatchBundleBody,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int | None]:
    validate_bundle_name(name)
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to patch")
    scopes = parse_scopes_json(key.scopes)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(selectinload(Bundle.group))
    )
    b = r.scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    pn = b.group.name if b.group else None
    ps = _pslug(b.group)
    if not can_write_bundle(
        scopes,
        bundle_name=b.name,
        group_id=b.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
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
            group_id=target_gid,
            project_name=new_pn,
            project_slug=new_ps,
        ):
            raise HTTPException(
                status_code=403,
                detail="Insufficient scope to set this project on the bundle",
            )
    b.group_id = target_gid
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
    return {"name": b.name, "group_id": b.group_id, "project_slug": out_slug}


@router.delete("/bundles/{name}", status_code=204)
async def delete_bundle(
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_name(name)
    scopes = parse_scopes_json(key.scopes)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(selectinload(Bundle.group))
    )
    b = r.scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    pn = b.group.name if b.group else None
    ps = _pslug(b.group)
    if not can_write_bundle(
        scopes,
        bundle_name=b.name,
        group_id=b.group_id,
        project_name=pn,
        project_slug=ps,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await session.execute(delete(Bundle).where(Bundle.id == b.id))
    await session.commit()
    return Response(status_code=204)


@router.get("/bundles/{name}")
async def get_bundle_decrypted(
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict:
    bundle, entries = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    secrets_map = {k: v[0] for k, v in entries.items()}
    secret_flags = {k: v[1] for k, v in entries.items()}
    return {
        "name": name,
        "secrets": secrets_map,
        "secret_flags": secret_flags,
        "group_id": bundle.group_id,
        "project_name": bundle.group.name if bundle.group else None,
        "project_slug": pslug,
    }


@router.get("/bundles/{name}/key-names")
async def get_bundle_key_names(
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, list[str]]:
    """Sorted key names from bundle secrets (not sealed secrets); for stack layer UI and automation."""
    validate_bundle_name(name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(selectinload(Bundle.group))
    )
    bundle = r.scalar_one_or_none()
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    keys = await list_bundle_secret_key_names(session, name)
    return {"keys": keys}


@router.get("/bundles/{name}/export")
@limiter.limit("120/minute")
async def export_bundle(
    request: Request,
    name: str,
    format: Literal["dotenv", "json"] = Query("dotenv"),
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, secrets_map = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
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
    name: str,
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Structured JSON backup for merge import (includes format id)."""
    validate_bundle_name(name)
    bundle, entries = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
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
    key: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_name(name)
    bundle, entries = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(key.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_read_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
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


@router.put("/bundles/{name}/backup")
async def import_bundle_backup_merge(
    name: str,
    body: BundleBackupPayloadV1,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int]:
    """Merge secrets from a v1 JSON backup into the named bundle (upsert keys)."""
    validate_bundle_name(name)
    if body.format != BUNDLE_BACKUP_FORMAT:
        raise HTTPException(status_code=400, detail="unsupported backup format")
    if body.bundle.strip() != name.strip():
        raise HTTPException(status_code=400, detail="backup bundle name does not match path")
    bundle, _ = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
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


@router.post("/bundles/{name}/backup/import-encrypted", response_model=None)
@limiter.limit("30/hour")
async def import_bundle_backup_encrypted(
    request: Request,
    name: str,
    file: UploadFile = File(...),
    passphrase: str = Form(...),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | int]:
    validate_bundle_name(name)
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
    return await import_bundle_backup_merge(name, payload, auth, session)


@router.post("/bundles/{name}/secrets", status_code=204)
async def upsert_secret(
    name: str,
    body: UpsertSecretBody,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
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
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await encrypt_plain_entry(session, name, key_name)
    await session.commit()
    return Response(status_code=204)


@router.post("/bundles/{name}/secrets/declassify", status_code=204)
async def declassify_encrypted_secret(
    name: str,
    key_name: str = Query(..., min_length=1, max_length=512),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")
    await declassify_secret_entry(session, name, key_name)
    await session.commit()
    return Response(status_code=204)


@router.delete("/bundles/{name}/secrets", status_code=204)
async def delete_secret(
    name: str,
    key_name: str = Query(..., min_length=1, max_length=512),
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    bundle, _ = await load_bundle_secrets(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
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
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, int | str]]:
    """List opaque env links (id and created time only; raw URL path is never stored)."""
    validate_bundle_name(name)
    bundle, _ = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
        group_id=bundle.group_id,
        project_name=pn,
        project_slug=pslug,
    ):
        raise HTTPException(
            status_code=403, detail="Insufficient scope to manage env links for this bundle"
        )
    r = await session.execute(
        select(BundleEnvLink.id, BundleEnvLink.created_at)
        .where(BundleEnvLink.bundle_id == bundle.id)
        .order_by(BundleEnvLink.created_at.desc())
    )
    return [
        {"id": row.id, "created_at": row.created_at.isoformat()}
        for row in r.all()
    ]


@router.post("/bundles/{name}/env-links", status_code=201)
@limiter.limit("30/minute")
async def create_bundle_env_link(
    request: Request,
    name: str,
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Create an opaque URL (no project/bundle names) that downloads this bundle as .env or JSON."""
    validate_bundle_name(name)
    bundle, _ = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
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
    auth: ApiKey = Depends(get_api_key),
    session: AsyncSession = Depends(get_db),
) -> Response:
    validate_bundle_name(name)
    bundle, _ = await load_bundle_entries(session, name)
    scopes = parse_scopes_json(auth.scopes)
    pn = bundle.group.name if bundle.group else None
    pslug = _pslug(bundle.group)
    if not can_write_bundle(
        scopes,
        bundle_name=bundle.name,
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
