import json
import secrets
from datetime import datetime, timezone
from urllib.parse import quote
from itertools import groupby
from typing import Annotated, Literal

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from starlette.status import HTTP_302_FOUND

from app.auth_keys import generate_raw_api_key, hash_api_key, verify_api_key
from app.config import get_settings
from app.db import get_db
from app.limiter import limiter
from app.models import (
    ApiKey,
    Bundle,
    BundleEnvLink,
    BundleGroup,
    BundleStack,
    BundleStackLayer,
    Certificate,
    SealedSecret,
    SealedSecretRecipient,
    Secret,
    StackEnvLink,
)
from app.paths import url_path
from app.services.projects import (
    get_project_by_slug_or_404,
    next_available_slug,
    slug_suggestion_from_name,
    validate_project_name,
    validate_project_slug,
)

# --- Bundles / stacks list helpers (global or per-project) ---


def _bundle_sections_from_rows(
    rows: list,
) -> tuple[list[dict[str, object]], int]:
    bundle_sections: list[dict[str, object]] = []
    for (proj_name, proj_slug), group in groupby(
        rows, key=lambda row: (row[1], row[2])
    ):
        title = proj_name if proj_name is not None else "Ungrouped"
        bundle_sections.append(
            {
                "title": title,
                "slug": proj_slug,
                "bundles": [
                    {"name": x[0], "secret_count": int(x[3])} for x in group
                ],
            }
        )
    return bundle_sections, len(rows)


async def _bundles_list_rows(
    session: AsyncSession, *, project_slug: str | None
) -> list:
    q = (
        select(
            Bundle.name,
            BundleGroup.name,
            BundleGroup.slug,
            func.count(Secret.id).label("n_secrets"),
        )
        .select_from(Bundle)
        .outerjoin(BundleGroup, Bundle.group_id == BundleGroup.id)
        .outerjoin(Secret, Secret.bundle_id == Bundle.id)
        .group_by(
            Bundle.id,
            Bundle.name,
            BundleGroup.id,
            BundleGroup.name,
            BundleGroup.slug,
        )
    )
    if project_slug is not None:
        q = q.where(BundleGroup.slug == project_slug.strip())
    q = q.order_by(BundleGroup.name.asc().nulls_last(), Bundle.name)
    r = await session.execute(q)
    return list(r.all())


def _stack_sections_from_rows(
    rows: list,
) -> tuple[list[dict[str, object]], int]:
    stack_sections: list[dict[str, object]] = []
    for (proj_name, proj_slug), group in groupby(
        rows, key=lambda row: (row[1], row[2])
    ):
        title = proj_name if proj_name is not None else "Ungrouped"
        stack_sections.append(
            {
                "title": title,
                "slug": proj_slug,
                "stacks": [
                    {"name": x[0], "layer_count": int(x[3])} for x in group
                ],
            }
        )
    return stack_sections, len(rows)


async def _stacks_list_rows(
    session: AsyncSession, *, project_slug: str | None
) -> list:
    q = (
        select(
            BundleStack.name,
            BundleGroup.name,
            BundleGroup.slug,
            func.count(BundleStackLayer.id).label("n_layers"),
        )
        .select_from(BundleStack)
        .outerjoin(BundleGroup, BundleStack.group_id == BundleGroup.id)
        .outerjoin(BundleStackLayer, BundleStackLayer.stack_id == BundleStack.id)
        .group_by(
            BundleStack.id,
            BundleStack.name,
            BundleGroup.id,
            BundleGroup.name,
            BundleGroup.slug,
        )
    )
    if project_slug is not None:
        q = q.where(BundleGroup.slug == project_slug.strip())
    q = q.order_by(BundleGroup.name.asc().nulls_last(), BundleStack.name)
    r = await session.execute(q)
    return list(r.all())
from app.services.backup_crypto import (
    WrongPassphraseError,
    decrypt_bytes,
    encrypt_bytes_async,
)
from app.services.backup_db import database_url_to_sqlite_path, replace_sqlite_database, snapshot_sqlite_bytes
from app.services.scopes import parse_scopes_json, scopes_allow_admin, scopes_to_json, validate_scopes_list
from app.services.bundles import (
    bulk_upsert_bundle_secrets,
    dedupe_entry_rows,
    duplicate_key_groups_from_object,
    declassify_secret_entry,
    encrypt_plain_entry,
    upsert_bundle_secret_entry,
    extract_conflicting_secret_key_name,
    format_secrets_dotenv,
    decrypt_bundle_entry_value,
    list_bundle_secret_key_names,
    load_bundle_entries,
    load_bundle_entries_list_masked,
    load_bundle_secrets,
    normalize_env_key,
    parse_bundle_entries_json,
    validate_bundle_name,
)
from app.services.stacks import (
    LayerSpec,
    get_stack_by_name,
    load_stack_secrets,
    load_stack_secrets_through,
    parse_layer_label_field,
    replace_stack_layers,
    stack_key_graph_payload_for_stack,
    validate_stack_name,
    validate_through_layer_position,
)
from app.services.env_links import new_env_link_token, token_sha256_hex
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="templates")

router = APIRouter()


def _bundle_edit_redirect_after_var_change(base: str, key_name: str) -> str:
    """Redirect target so bundle edit can scroll the affected row into view (see ?highlight=)."""
    k = key_name.strip()
    if not k:
        return f"{base}/edit"
    return f"{base}/edit?highlight={quote(k, safe='')}"


def _bundle_web_base(project_slug: str | None, bundle_name: str) -> str:
    """Canonical web path prefix for a bundle (no trailing slash)."""
    if project_slug is not None:
        return url_path(f"/projects/{project_slug}/bundles/{bundle_name}")
    return url_path(f"/bundles/{bundle_name}")


async def _validate_bundle_in_project(
    session: AsyncSession, project_slug: str, bundle_name: str
) -> None:
    validate_bundle_name(bundle_name)
    r = await session.execute(
        select(Bundle.id)
        .join(BundleGroup, Bundle.group_id == BundleGroup.id)
        .where(Bundle.name == bundle_name, BundleGroup.slug == project_slug.strip())
    )
    if r.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Bundle not found in this project")


async def _validate_bundle_ungrouped_web(session: AsyncSession, bundle_name: str) -> None:
    """Legacy /bundles/... URLs only apply to bundles without a project."""
    validate_bundle_name(bundle_name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == bundle_name).options(joinedload(Bundle.group))
    )
    b = r.unique().scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    if b.group_id is not None and b.group is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This bundle lives under project “{b.group.name}”; "
                f"use {url_path(f'/projects/{b.group.slug}/bundles/{bundle_name}/edit')}"
            ),
        )


def _stack_web_base(project_slug: str | None, stack_name: str) -> str:
    if project_slug is not None:
        return url_path(f"/projects/{project_slug}/stacks/{stack_name}")
    return url_path(f"/stacks/{stack_name}")


async def _validate_stack_in_project(
    session: AsyncSession, project_slug: str, stack_name: str
) -> None:
    validate_stack_name(stack_name)
    r = await session.execute(
        select(BundleStack.id)
        .join(BundleGroup, BundleStack.group_id == BundleGroup.id)
        .where(BundleStack.name == stack_name, BundleGroup.slug == project_slug.strip())
    )
    if r.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Stack not found in this project")


async def _validate_stack_ungrouped_web(session: AsyncSession, stack_name: str) -> None:
    validate_stack_name(stack_name)
    r = await session.execute(
        select(BundleStack).where(BundleStack.name == stack_name).options(joinedload(BundleStack.group))
    )
    st = r.unique().scalar_one_or_none()
    if st is None:
        raise HTTPException(status_code=404, detail="Stack not found")
    if st.group_id is not None and st.group is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This stack lives under project “{st.group.name}”; "
                f"use {url_path(f'/projects/{st.group.slug}/stacks/{stack_name}/edit')}"
            ),
        )


def _stack_layers_json_for_template(st: BundleStack) -> str:
    layers = sorted(st.layers, key=lambda L: L.position)
    payload: list[dict[str, object]] = []
    for layer in layers:
        item: dict[str, object]
        if getattr(layer, "keys_mode", "all") != "pick" or not layer.selected_keys_json:
            item = {"bundle": layer.bundle.name, "keys": "*"}
        else:
            item = {"bundle": layer.bundle.name, "keys": json.loads(layer.selected_keys_json)}
        raw_lbl = getattr(layer, "layer_label", None)
        if isinstance(raw_lbl, str) and raw_lbl.strip():
            item["label"] = raw_lbl.strip()
        payload.append(item)
    return json.dumps(payload)


async def _bundles_by_project_slug_map(session: AsyncSession) -> dict[str, list[str]]:
    r = await session.execute(
        select(BundleGroup.slug, Bundle.name)
        .select_from(Bundle)
        .join(BundleGroup, Bundle.group_id == BundleGroup.id)
        .order_by(BundleGroup.slug, Bundle.name)
    )
    by_slug: dict[str, list[str]] = {}
    for slug, bname in r.all():
        by_slug.setdefault(slug, []).append(bname)
    return by_slug


async def _bundle_names_in_project(session: AsyncSession, group_id: int) -> list[str]:
    r = await session.execute(select(Bundle.name).where(Bundle.group_id == group_id).order_by(Bundle.name))
    return [row[0] for row in r.all()]


async def _all_bundle_names(session: AsyncSession) -> list[str]:
    r = await session.execute(select(Bundle.name).order_by(Bundle.name))
    return [row[0] for row in r.all()]


def _parse_stack_layers_json(raw: str) -> list[LayerSpec]:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Configure at least one layer")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid layers JSON: {e}") from None
    if not isinstance(data, list) or len(data) == 0:
        raise ValueError("Add at least one layer")
    out: list[LayerSpec] = []
    for item in data:
        if isinstance(item, str):
            bn = item.strip()
            if not bn:
                continue
            validate_bundle_name(bn)
            out.append(LayerSpec(bn, None, None))
            continue
        if not isinstance(item, dict):
            raise ValueError("Each layer must be an object or string")
        bn = str(item.get("bundle", "")).strip()
        if not bn:
            raise ValueError("Each layer needs a bundle name")
        validate_bundle_name(bn)
        lbl = parse_layer_label_field(item.get("label"))
        keys = item.get("keys", "*")
        if keys in ("*", "all"):
            out.append(LayerSpec(bn, None, lbl))
        elif isinstance(keys, list):
            kl = [str(k).strip() for k in keys if str(k).strip()]
            if not kl:
                raise ValueError("Select at least one variable or choose all keys")
            out.append(LayerSpec(bn, kl, lbl))
        else:
            raise ValueError('layer "keys" must be "*" or a list of key names')
    if not out:
        raise ValueError("Add at least one layer")
    return out


async def _bundle_edit_template(
    request: Request,
    session: AsyncSession,
    name: str,
    key: str | None,
    bundle_route_base: str,
    project_slug: str | None,
    highlight: str | None = None,
) -> HTMLResponse:
    try:
        _bundle, entries = await load_bundle_entries_list_masked(session, name)
    except HTTPException as e:
        if e.status_code == 404:
            return templates.TemplateResponse(
                "error.html",
                {"request": request, "message": "Bundle not found"},
                status_code=404,
            )
        raise
    items = sorted(entries.items(), key=lambda x: x[0])
    editing: dict[str, object] | None = None
    edit_error: str | None = None
    highlight_key: str | None = None
    flash_err = request.session.pop("bundle_edit_error", None)
    if key is not None and key.strip():
        kn = key.strip()
        if kn in entries:
            highlight_key = kn
            _list_val, is_sec = entries[kn]
            if is_sec:
                try:
                    plain, _ = await decrypt_bundle_entry_value(session, name, kn)
                except HTTPException as e:
                    if e.status_code == 404:
                        edit_error = "No entry with that key."
                    else:
                        raise
                else:
                    editing = {"key": kn, "value": plain, "is_secret": True}
            else:
                editing = {"key": kn, "value": _list_val or "", "is_secret": False}
            if flash_err:
                edit_error = flash_err
        else:
            edit_error = "No entry with that key."
    elif highlight is not None and highlight.strip():
        hn = highlight.strip()
        if hn in entries:
            highlight_key = hn
    if edit_error is None and flash_err:
        edit_error = flash_err
    return templates.TemplateResponse(
        "bundle_edit.html",
        {
            "request": request,
            "bundle_name": name,
            "bundle_route_base": bundle_route_base,
            "project_slug": project_slug,
            "secrets": [(k, v[0], v[1]) for k, v in items],
            "editing": editing,
            "edit_error": edit_error,
            "highlight_key": highlight_key,
            "csrf_token": _csrf_token(request),
            "secret_values_json_url": f"{bundle_route_base}/secret-values",
            "bundle_subnav_active": "variables",
        },
    )


async def _bundle_env_links_template(
    request: Request,
    session: AsyncSession,
    name: str,
    bundle_route_base: str,
    project_slug: str | None,
    *,
    new_env_url: str | None = None,
) -> HTMLResponse:
    r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bid = r.scalar_one_or_none()
    if bid is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    lr = await session.execute(
        select(BundleEnvLink)
        .where(BundleEnvLink.bundle_id == bid)
        .order_by(BundleEnvLink.created_at.desc())
    )
    env_links = lr.scalars().all()
    return templates.TemplateResponse(
        "bundle_env_links.html",
        {
            "request": request,
            "bundle_name": name,
            "bundle_route_base": bundle_route_base,
            "project_slug": project_slug,
            "csrf_token": _csrf_token(request),
            "env_links": env_links,
            "new_env_url": new_env_url,
            "bundle_subnav_active": "env-links",
        },
    )


def _certificate_fingerprint_sha256_hex(certificate_pem: str) -> str:
    try:
        cert = x509.load_pem_x509_certificate(certificate_pem.encode("utf-8"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid PEM certificate") from e
    return cert.fingerprint(hashes.SHA256()).hex()


async def _certificates_template(
    request: Request,
    session: AsyncSession,
    *,
    error: str | None = None,
    form_name: str = "",
    form_certificate_pem: str = "",
) -> HTMLResponse:
    r = await session.execute(select(Certificate).order_by(Certificate.name))
    rows = r.scalars().all()
    ur = await session.execute(
        select(
            SealedSecretRecipient.certificate_id,
            func.count(SealedSecretRecipient.id).label("n"),
        )
        .group_by(SealedSecretRecipient.certificate_id)
    )
    usage_by_cert = {int(row.certificate_id): int(row.n) for row in ur.all()}
    certificates = [
        {
            "id": row.id,
            "name": row.name,
            "fingerprint_sha256": row.fingerprint_sha256,
            "created_at": row.created_at,
            "usage_count": usage_by_cert.get(row.id, 0),
        }
        for row in rows
    ]
    return templates.TemplateResponse(
        "certificates.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "error": error,
            "form_name": form_name,
            "form_certificate_pem": form_certificate_pem,
            "certificates": certificates,
        },
    )


def _default_recipients_json(certificates: list[Certificate]) -> str:
    if not certificates:
        return '[{"certificate_id": 1, "wrapped_key": "BASE64_WRAPPED_KEY", "key_wrap_alg": "rsa-oaep-256"}]'
    first = certificates[0]
    return (
        "[\n"
        f'  {{"certificate_id": {first.id}, "wrapped_key": "BASE64_WRAPPED_KEY", "key_wrap_alg": "rsa-oaep-256"}}\n'
        "]"
    )


def _parse_recipients_json(raw: str) -> tuple[list[dict[str, object]], str | None]:
    text = raw.strip()
    if not text:
        return [], "Recipients JSON is required"
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return [], f"Recipients JSON is invalid: {e}"
    if not isinstance(data, list) or not data:
        return [], "Recipients JSON must be a non-empty JSON array"
    deduped: dict[int, dict[str, object]] = {}
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            return [], f"Recipient #{idx + 1} must be an object"
        cid = item.get("certificate_id")
        wrapped = item.get("wrapped_key")
        alg = item.get("key_wrap_alg", "rsa-oaep-256")
        if not isinstance(cid, int) or cid < 1:
            return [], f"Recipient #{idx + 1} certificate_id must be a positive integer"
        if not isinstance(wrapped, str) or not wrapped.strip():
            return [], f"Recipient #{idx + 1} wrapped_key is required"
        if not isinstance(alg, str) or not alg.strip():
            return [], f"Recipient #{idx + 1} key_wrap_alg is required"
        deduped[cid] = {
            "certificate_id": cid,
            "wrapped_key": wrapped.strip(),
            "key_wrap_alg": alg.strip(),
        }
    return list(deduped.values()), None


async def _bundle_sealed_secrets_template(
    request: Request,
    session: AsyncSession,
    name: str,
    bundle_route_base: str,
    project_slug: str | None,
    *,
    error: str | None = None,
    form_values: dict[str, str] | None = None,
) -> HTMLResponse:
    r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bid = r.scalar_one_or_none()
    if bid is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    cr = await session.execute(select(Certificate).order_by(Certificate.name))
    certificates = cr.scalars().all()
    cert_name_by_id = {int(c.id): c.name for c in certificates}
    sr = await session.execute(
        select(SealedSecret)
        .where(SealedSecret.bundle_id == bid)
        .options(joinedload(SealedSecret.recipients))
        .order_by(SealedSecret.key_name)
    )
    sealed_rows = sr.unique().scalars().all()
    initial_values = {
        "key_name": "",
        "enc_alg": "aes-256-gcm",
        "payload_ciphertext": "",
        "payload_nonce": "",
        "payload_aad": "",
        "recipients_json": _default_recipients_json(certificates),
    }
    if form_values:
        initial_values.update(form_values)
    return templates.TemplateResponse(
        "bundle_sealed_secrets.html",
        {
            "request": request,
            "bundle_name": name,
            "bundle_route_base": bundle_route_base,
            "project_slug": project_slug,
            "csrf_token": _csrf_token(request),
            "bundle_subnav_active": "sealed-secrets",
            "sealed_secrets": sealed_rows,
            "certificates": certificates,
            "certificate_name_by_id": cert_name_by_id,
            "error": error,
            "form_values": initial_values,
        },
    )


async def _projects_for_select(session: AsyncSession) -> list[tuple[str, str]]:
    """(slug, display name) for HTML selects."""
    r = await session.execute(
        select(BundleGroup.slug, BundleGroup.name).order_by(BundleGroup.name)
    )
    return list(r.all())


async def _keys_template_context(
    session: AsyncSession,
    request: Request,
    *,
    keys: list,
    csrf_token: str,
    new_plain_key: str | None = None,
    scopes_error: str | None = None,
    scopes_json_value: str = '["read:bundle:*"]',
) -> dict[str, object]:
    """Projects/bundles lists for scope builder dropdowns on the keys page."""
    pr = await session.execute(
        select(BundleGroup.slug, BundleGroup.name).order_by(BundleGroup.name)
    )
    projects_for_scopes = [{"slug": row.slug, "name": row.name} for row in pr.all()]
    br = await session.execute(select(Bundle.name).order_by(Bundle.name))
    bundles_for_scopes = [row[0] for row in br.all()]
    sr = await session.execute(select(BundleStack.name).order_by(BundleStack.name))
    stacks_for_scopes = [row[0] for row in sr.all()]
    return {
        "request": request,
        "keys": keys,
        "csrf_token": csrf_token,
        "new_plain_key": new_plain_key,
        "scopes_error": scopes_error,
        "scopes_json_value": scopes_json_value,
        "projects_for_scopes": projects_for_scopes,
        "bundles_for_scopes": bundles_for_scopes,
        "stacks_for_scopes": stacks_for_scopes,
    }


def _require_web_admin(request: Request) -> RedirectResponse | None:
    if request.session.get("admin") is True:
        return None
    return RedirectResponse(url_path("/login"), status_code=HTTP_302_FOUND)


def _csrf_token(request: Request) -> str:
    tok = request.session.get("csrf")
    if not tok:
        tok = secrets.token_hex(16)
        request.session["csrf"] = tok
    return tok


def _check_csrf(request: Request, csrf: str | None) -> None:
    expected = request.session.get("csrf")
    if not csrf or not expected or csrf != expected:
        raise HTTPException(status_code=400, detail="Invalid CSRF token")


def _absolute_base(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _form_through_layer_position(raw: str | None) -> int | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid through_layer_position")


@router.get("/env/{env_token}")
@limiter.limit("60/minute")
async def download_env_by_secret_token(
    request: Request,
    env_token: str,
    format: Literal["dotenv", "json"] = Query("dotenv"),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Public download: token maps to a bundle export or merged stack export (no names in URL)."""
    raw = (env_token or "").strip()
    if len(raw) < 16 or len(raw) > 256:
        raise HTTPException(status_code=404, detail="Not found")
    digest = token_sha256_hex(raw)
    r = await session.execute(
        select(BundleEnvLink, Bundle)
        .join(Bundle, BundleEnvLink.bundle_id == Bundle.id)
        .where(BundleEnvLink.token_sha256 == digest)
    )
    row = r.one_or_none()
    if row is not None:
        _link, bundle = row
        _, secrets_map = await load_bundle_secrets(session, bundle.name)
    else:
        rs = await session.execute(
            select(StackEnvLink, BundleStack)
            .join(BundleStack, StackEnvLink.stack_id == BundleStack.id)
            .where(StackEnvLink.token_sha256 == digest)
        )
        row2 = rs.one_or_none()
        if row2 is None:
            raise HTTPException(status_code=404, detail="Not found")
        slink, stack = row2
        stack = await get_stack_by_name(session, stack.name)
        assert stack is not None
        if slink.through_layer_position is not None:
            secrets_map = await load_stack_secrets_through(
                session, stack, slink.through_layer_position
            )
        else:
            secrets_map = await load_stack_secrets(session, stack)
    if format == "json":
        body = json.dumps(secrets_map, sort_keys=True, indent=2) + "\n"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="environment.json"'},
        )
    text = format_secrets_dotenv(secrets_map)
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="environment.env"'},
    )


def _help_ctx(request: Request, section: str) -> dict:
    return {"request": request, "help_section": section}


@router.get("/help", response_class=HTMLResponse, response_model=None)
async def help_index(request: Request) -> HTMLResponse:
    """Public documentation overview."""
    return templates.TemplateResponse("help_index.html", _help_ctx(request, "index"))


@router.get("/help/web-ui", response_class=HTMLResponse, response_model=None)
async def help_web_ui(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_web_ui.html", _help_ctx(request, "web-ui"))


@router.get("/help/api", response_class=HTMLResponse, response_model=None)
async def help_api(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_api.html", _help_ctx(request, "api"))


@router.get("/help/certificates", response_class=HTMLResponse, response_model=None)
async def help_certificates(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_certificates.html", _help_ctx(request, "certificates"))


@router.get("/help/terraform", response_class=HTMLResponse, response_model=None)
async def help_terraform(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_terraform.html", _help_ctx(request, "terraform"))


@router.get("/help/pulumi", response_class=HTMLResponse, response_model=None)
async def help_pulumi(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_pulumi.html", _help_ctx(request, "pulumi"))


@router.get("/help/backup", response_class=HTMLResponse, response_model=None)
async def help_backup(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("help_backup.html", _help_ctx(request, "backup"))


@router.get("/login", response_class=HTMLResponse, response_model=None)
async def login_get(request: Request) -> HTMLResponse:
    if request.session.get("admin"):
        return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)
    return templates.TemplateResponse(
        "login.html",
        {"request": request, "csrf_token": _csrf_token(request), "error": None},
    )


@router.post("/login", response_model=None)
@limiter.limit("20/minute")
async def login_post(
    request: Request,
    api_key: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    _check_csrf(request, csrf)
    api_key = api_key.strip()
    if not api_key:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "API key required",
            },
            status_code=400,
        )
    r = await session.execute(select(ApiKey))
    rows = r.scalars().all()
    for row in rows:
        if verify_api_key(api_key, row.key_hash) and scopes_allow_admin(
            parse_scopes_json(row.scopes)
        ):
            request.session["admin"] = True
            request.session.pop("csrf", None)
            return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "error": "Invalid admin API key",
        },
        status_code=401,
    )


@router.post("/logout", response_model=None)
async def logout(request: Request, csrf: Annotated[str, Form()]) -> RedirectResponse:
    _check_csrf(request, csrf)
    request.session.clear()
    return RedirectResponse(url_path("/login"), status_code=HTTP_302_FOUND)


@router.get("/", response_class=HTMLResponse, response_model=None)
async def root(request: Request) -> RedirectResponse:
    if request.session.get("admin"):
        return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)
    return RedirectResponse(url_path("/login"), status_code=HTTP_302_FOUND)


@router.get("/bundles", response_model=None)
async def bundles_list_gone(request: Request) -> RedirectResponse:
    """Global bundle list removed; open a project from /projects."""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.get(
    "/projects/{project_slug}/bundles",
    response_class=HTMLResponse,
    response_model=None,
)
async def bundles_list_in_project(
    request: Request,
    project_slug: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    g = await get_project_by_slug_or_404(session, project_slug)
    rows = await _bundles_list_rows(session, project_slug=project_slug)
    bundle_sections, total_bundles = _bundle_sections_from_rows(rows)
    return templates.TemplateResponse(
        "bundles_list.html",
        {
            "request": request,
            "bundle_sections": bundle_sections,
            "total_bundles": total_bundles,
            "list_project_slug": project_slug.strip(),
            "list_project_name": g.name,
            "csrf_token": _csrf_token(request),
        },
    )


@router.get("/stacks", response_model=None)
async def stacks_list_gone(request: Request) -> RedirectResponse:
    """Global stack list removed; open a project from /projects."""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.get(
    "/projects/{project_slug}/stacks",
    response_class=HTMLResponse,
    response_model=None,
)
async def stacks_list_in_project(
    request: Request,
    project_slug: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    g = await get_project_by_slug_or_404(session, project_slug)
    rows = await _stacks_list_rows(session, project_slug=project_slug)
    stack_sections, total_stacks = _stack_sections_from_rows(rows)
    return templates.TemplateResponse(
        "stacks_list.html",
        {
            "request": request,
            "stack_sections": stack_sections,
            "total_stacks": total_stacks,
            "list_project_slug": project_slug.strip(),
            "list_project_name": g.name,
            "csrf_token": _csrf_token(request),
        },
    )


@router.get("/stacks/new", response_class=HTMLResponse, response_model=None)
async def stack_new_get(
    request: Request, session: AsyncSession = Depends(get_db)
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    projects = await _projects_for_select(session)
    bundles_map = await _bundles_by_project_slug_map(session)
    return templates.TemplateResponse(
        "stack_new.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "error": None,
            "projects": projects,
            "bundles_by_project_json": json.dumps(bundles_map),
        },
    )


@router.post("/stacks/new", response_model=None)
async def stack_new_post(
    request: Request,
    name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    layers_json: Annotated[str, Form()] = "",
    project_slug: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    projects = await _projects_for_select(session)
    bundles_map = await _bundles_by_project_slug_map(session)
    bundles_by_project_json = json.dumps(bundles_map)
    name = name.strip()
    if not projects:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Create a project first, then add a stack.",
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=400,
        )
    slug_in = (project_slug or "").strip()
    if not slug_in:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Select a project for this stack.",
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=400,
        )
    try:
        g = await get_project_by_slug_or_404(session, slug_in)
    except HTTPException as e:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=e.status_code,
        )
    try:
        validate_stack_name(name)
    except HTTPException as e:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=400,
        )
    existing = await session.execute(select(BundleStack.id).where(BundleStack.name == name))
    if existing.scalar_one_or_none() is not None:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Stack already exists",
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=409,
        )
    try:
        layer_specs = _parse_stack_layers_json(layers_json)
    except ValueError as e:
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": str(e),
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=400,
        )
    st = BundleStack(name=name, group_id=g.id)
    session.add(st)
    await session.flush()
    try:
        await replace_stack_layers(session, st.id, layer_specs)
    except HTTPException as e:
        await session.rollback()
        return templates.TemplateResponse(
            "stack_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "projects": projects,
                "bundles_by_project_json": bundles_by_project_json,
            },
            status_code=e.status_code,
        )
    await session.commit()
    return RedirectResponse(
        url_path(f"/projects/{g.slug}/stacks/{name}/edit"),
        status_code=HTTP_302_FOUND,
    )


@router.get("/projects/{project_slug}/stacks/{name}", response_model=None)
async def stack_in_project_short_url(
    request: Request,
    project_slug: str,
    name: str,
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return RedirectResponse(
        url_path(f"/projects/{project_slug}/stacks/{name}/edit"),
        status_code=HTTP_302_FOUND,
    )


@router.get(
    "/projects/{project_slug}/stacks/{name}/edit",
    response_class=HTMLResponse,
    response_model=None,
)
async def stack_edit_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_stack_in_project(session, project_slug, name)
    base = _stack_web_base(project_slug, name)
    return await _stack_edit_template(request, session, name, base, project_slug)


@router.get("/stacks/{name}/edit", response_class=HTMLResponse, response_model=None)
async def stack_edit_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_stack_name(name)
    r = await session.execute(
        select(BundleStack).where(BundleStack.name == name).options(joinedload(BundleStack.group))
    )
    st = r.unique().scalar_one_or_none()
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    if st.group_id and st.group:
        return RedirectResponse(
            url_path(f"/projects/{st.group.slug}/stacks/{name}/edit"),
            status_code=HTTP_302_FOUND,
        )
    base = _stack_web_base(None, name)
    return await _stack_edit_template(request, session, name, base, None)


async def _stack_edit_template(
    request: Request,
    session: AsyncSession,
    name: str,
    stack_route_base: str,
    project_slug: str | None,
    *,
    layers_json_override: str | None = None,
    error: str | None = None,
) -> HTMLResponse:
    st = await get_stack_by_name(session, name)
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    if st.group_id is not None:
        bundles = await _bundle_names_in_project(session, st.group_id)
    else:
        bundles = await _all_bundle_names(session)
    layers_json = (
        layers_json_override
        if layers_json_override is not None
        else _stack_layers_json_for_template(st)
    )
    return templates.TemplateResponse(
        "stack_edit.html",
        {
            "request": request,
            "stack_name": name,
            "stack_route_base": stack_route_base,
            "project_slug": project_slug or "",
            "layers_json": layers_json,
            "bundles_json": json.dumps(bundles),
            "csrf_token": _csrf_token(request),
            "stack_subnav_active": "layers",
            "error": error,
        },
        status_code=400 if error else 200,
    )


@router.post("/projects/{project_slug}/stacks/{name}/edit", response_model=None)
async def stack_edit_post_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    layers_json: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_in_project(session, project_slug, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    base = _stack_web_base(project_slug, name)
    try:
        layer_specs = _parse_stack_layers_json(layers_json)
    except ValueError as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            project_slug,
            layers_json_override=layers_json,
            error=str(e),
        )
    try:
        await replace_stack_layers(session, st.id, layer_specs)
    except HTTPException as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            project_slug,
            layers_json_override=layers_json,
            error=str(e.detail),
        )
    await session.commit()
    return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)


@router.post("/stacks/{name}/edit", response_model=None)
async def stack_edit_post_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    layers_json: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_ungrouped_web(session, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    base = _stack_web_base(None, name)
    try:
        layer_specs = _parse_stack_layers_json(layers_json)
    except ValueError as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            None,
            layers_json_override=layers_json,
            error=str(e),
        )
    try:
        await replace_stack_layers(session, st.id, layer_specs)
    except HTTPException as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            None,
            layers_json_override=layers_json,
            error=str(e.detail),
        )
    await session.commit()
    return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/stacks/{name}/rename", response_model=None)
async def stack_rename_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    new_name: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_in_project(session, project_slug, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    base = _stack_web_base(project_slug, name)
    raw = (new_name or "").strip()
    if not raw:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            project_slug,
            error="Stack name is required",
        )
    try:
        validate_stack_name(raw)
    except HTTPException as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            project_slug,
            error=str(e.detail),
        )
    if raw == name:
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)
    dup = await session.execute(select(BundleStack.id).where(BundleStack.name == raw))
    if dup.scalar_one_or_none() is not None:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            project_slug,
            error="A stack with that name already exists",
        )
    st.name = raw
    await session.commit()
    new_base = _stack_web_base(project_slug, raw)
    return RedirectResponse(f"{new_base}/edit", status_code=HTTP_302_FOUND)


@router.post("/stacks/{name}/rename", response_model=None)
async def stack_rename_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    new_name: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_ungrouped_web(session, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    base = _stack_web_base(None, name)
    raw = (new_name or "").strip()
    if not raw:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            None,
            error="Stack name is required",
        )
    try:
        validate_stack_name(raw)
    except HTTPException as e:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            None,
            error=str(e.detail),
        )
    if raw == name:
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)
    dup = await session.execute(select(BundleStack.id).where(BundleStack.name == raw))
    if dup.scalar_one_or_none() is not None:
        return await _stack_edit_template(
            request,
            session,
            name,
            base,
            None,
            error="A stack with that name already exists",
        )
    st.name = raw
    await session.commit()
    new_base = _stack_web_base(None, raw)
    return RedirectResponse(f"{new_base}/edit", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/stacks/{name}/delete", response_model=None)
async def stack_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_in_project(session, project_slug, name)
    validate_stack_name(name)
    await session.execute(delete(BundleStack).where(BundleStack.name == name))
    await session.commit()
    return RedirectResponse(
        url_path(f"/projects/{project_slug.strip()}/stacks"), status_code=HTTP_302_FOUND
    )


@router.post("/stacks/{name}/delete", response_model=None)
async def stack_delete_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_ungrouped_web(session, name)
    validate_stack_name(name)
    await session.execute(delete(BundleStack).where(BundleStack.name == name))
    await session.commit()
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.get("/projects/{project_slug}/bundles/{name}/variable-key-names", response_model=None)
async def web_bundle_variable_key_names_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if request.session.get("admin") is not True:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    await _validate_bundle_in_project(session, project_slug, name)
    keys = await list_bundle_secret_key_names(session, name)
    return JSONResponse({"keys": keys})


@router.get("/bundles/{name}/variable-key-names", response_model=None)
async def web_bundle_variable_key_names_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if request.session.get("admin") is not True:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    await _validate_bundle_ungrouped_web(session, name)
    keys = await list_bundle_secret_key_names(session, name)
    return JSONResponse({"keys": keys})


async def _stack_env_links_template(
    request: Request,
    session: AsyncSession,
    name: str,
    stack_route_base: str,
    project_slug: str | None,
    *,
    new_env_url: str | None = None,
) -> HTMLResponse:
    st = await get_stack_by_name(session, name)
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    layers_sorted = sorted(st.layers, key=lambda L: L.position)
    pos_to_bundle = {L.position: L.bundle.name for L in layers_sorted}
    stack_layers = [
        {"position": L.position, "bundle_name": L.bundle.name} for L in layers_sorted
    ]
    lr = await session.execute(
        select(
            StackEnvLink.id,
            StackEnvLink.created_at,
            StackEnvLink.through_layer_position,
        )
        .where(StackEnvLink.stack_id == st.id)
        .order_by(StackEnvLink.created_at.desc())
    )
    links = []
    for row in lr.all():
        tpl = row.through_layer_position
        slice_label = pos_to_bundle.get(tpl) if tpl is not None else None
        links.append(
            {
                "id": row.id,
                "created_at": row.created_at,
                "through_layer_position": tpl,
                "slice_label": slice_label,
            }
        )
    flash = new_env_url or request.session.pop("flash_stack_env_link_url", None)
    return templates.TemplateResponse(
        "stack_env_links.html",
        {
            "request": request,
            "stack_name": name,
            "stack_route_base": stack_route_base,
            "project_slug": project_slug,
            "csrf_token": _csrf_token(request),
            "env_links": links,
            "stack_layers": stack_layers,
            "new_env_url": flash,
            "stack_subnav_active": "env-links",
        },
    )


@router.get(
    "/projects/{project_slug}/stacks/{name}/env-links",
    response_class=HTMLResponse,
    response_model=None,
)
async def stack_env_links_page_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_stack_in_project(session, project_slug, name)
    base = _stack_web_base(project_slug, name)
    flash_url = request.session.pop("flash_stack_env_link_url", None)
    return await _stack_env_links_template(
        request,
        session,
        name,
        base,
        project_slug,
        new_env_url=flash_url,
    )


async def _stack_key_graph_template(
    request: Request,
    session: AsyncSession,
    name: str,
    stack_route_base: str,
    project_slug: str | None,
) -> HTMLResponse:
    st = await get_stack_by_name(session, name)
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    return templates.TemplateResponse(
        "stack_key_graph.html",
        {
            "request": request,
            "stack_name": name,
            "stack_route_base": stack_route_base,
            "project_slug": project_slug or "",
            "csrf_token": _csrf_token(request),
            "stack_subnav_active": "key-graph",
        },
    )


@router.get(
    "/projects/{project_slug}/stacks/{name}/key-graph",
    response_class=HTMLResponse,
    response_model=None,
)
async def stack_key_graph_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_stack_in_project(session, project_slug, name)
    base = _stack_web_base(project_slug, name)
    return await _stack_key_graph_template(
        request, session, name, base, project_slug
    )


@router.get("/stacks/{name}/key-graph", response_class=HTMLResponse, response_model=None)
async def stack_key_graph_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_stack_name(name)
    r = await session.execute(
        select(BundleStack).where(BundleStack.name == name).options(joinedload(BundleStack.group))
    )
    st = r.unique().scalar_one_or_none()
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    if st.group_id and st.group:
        return RedirectResponse(
            url_path(f"/projects/{st.group.slug}/stacks/{name}/key-graph"),
            status_code=HTTP_302_FOUND,
        )
    base = _stack_web_base(None, name)
    return await _stack_key_graph_template(request, session, name, base, None)


@router.get(
    "/projects/{project_slug}/stacks/{name}/key-graph/data",
    response_model=None,
)
async def stack_key_graph_data_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if request.session.get("admin") is not True:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    await _validate_stack_in_project(session, project_slug, name)
    st = await get_stack_by_name(session, name)
    if st is None:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    payload = await stack_key_graph_payload_for_stack(session, st)
    return JSONResponse(payload)


@router.get("/stacks/{name}/key-graph/data", response_model=None)
async def stack_key_graph_data_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if request.session.get("admin") is not True:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    await _validate_stack_ungrouped_web(session, name)
    st = await get_stack_by_name(session, name)
    if st is None:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    payload = await stack_key_graph_payload_for_stack(session, st)
    return JSONResponse(payload)


@router.get("/stacks/{name}/env-links", response_class=HTMLResponse, response_model=None)
async def stack_env_links_page_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_stack_name(name)
    r = await session.execute(
        select(BundleStack).where(BundleStack.name == name).options(joinedload(BundleStack.group))
    )
    st = r.unique().scalar_one_or_none()
    if st is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Stack not found"},
            status_code=404,
        )
    if st.group_id and st.group:
        return RedirectResponse(
            url_path(f"/projects/{st.group.slug}/stacks/{name}/env-links"),
            status_code=HTTP_302_FOUND,
        )
    base = _stack_web_base(None, name)
    flash_url = request.session.pop("flash_stack_env_link_url", None)
    return await _stack_env_links_template(
        request, session, name, base, None, new_env_url=flash_url
    )


@router.post("/projects/{project_slug}/stacks/{name}/env-links", response_model=None)
async def stack_env_link_create_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
    through_layer_position: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_in_project(session, project_slug, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    tpl = validate_through_layer_position(st, _form_through_layer_position(through_layer_position))
    raw, digest = new_env_link_token()
    session.add(
        StackEnvLink(stack_id=st.id, token_sha256=digest, through_layer_position=tpl)
    )
    await session.commit()
    request.session["flash_stack_env_link_url"] = f"{_absolute_base(request)}/env/{raw}"
    base = _stack_web_base(project_slug, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/stacks/{name}/env-links", response_model=None)
async def stack_env_link_create_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
    through_layer_position: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_ungrouped_web(session, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    tpl = validate_through_layer_position(st, _form_through_layer_position(through_layer_position))
    raw, digest = new_env_link_token()
    session.add(
        StackEnvLink(stack_id=st.id, token_sha256=digest, through_layer_position=tpl)
    )
    await session.commit()
    request.session["flash_stack_env_link_url"] = f"{_absolute_base(request)}/env/{raw}"
    base = _stack_web_base(None, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/stacks/{name}/env-links/{link_id}/delete", response_model=None)
async def stack_env_link_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    link_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_in_project(session, project_slug, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    await session.execute(
        delete(StackEnvLink).where(
            StackEnvLink.id == link_id,
            StackEnvLink.stack_id == st.id,
        )
    )
    await session.commit()
    base = _stack_web_base(project_slug, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/stacks/{name}/env-links/{link_id}/delete", response_model=None)
async def stack_env_link_delete_legacy(
    request: Request,
    name: str,
    link_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_stack_ungrouped_web(session, name)
    st = await get_stack_by_name(session, name)
    assert st is not None
    await session.execute(
        delete(StackEnvLink).where(
            StackEnvLink.id == link_id,
            StackEnvLink.stack_id == st.id,
        )
    )
    await session.commit()
    base = _stack_web_base(None, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.get("/bundles/new", response_class=HTMLResponse, response_model=None)
async def bundle_new_get(
    request: Request, session: AsyncSession = Depends(get_db)
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    projects = await _projects_for_select(session)
    return templates.TemplateResponse(
        "bundle_new.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "error": None,
            "projects": projects,
        },
    )


@router.post("/bundles/new", response_model=None)
async def bundle_new_post(
    request: Request,
    name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    initial_json: Annotated[str, Form()] = "",
    project_slug: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    projects = await _projects_for_select(session)
    name = name.strip()
    if not projects:
        return templates.TemplateResponse(
            "bundle_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Create a project first, then add a bundle.",
                "projects": projects,
            },
            status_code=400,
        )
    slug_in = (project_slug or "").strip()
    if not slug_in:
        return templates.TemplateResponse(
            "bundle_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Select a project for this bundle.",
                "projects": projects,
            },
            status_code=400,
        )
    try:
        g = await get_project_by_slug_or_404(session, slug_in)
    except HTTPException as e:
        return templates.TemplateResponse(
            "bundle_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "projects": projects,
            },
            status_code=e.status_code,
        )
    gid = g.id
    try:
        validate_bundle_name(name)
    except HTTPException as e:
        return templates.TemplateResponse(
            "bundle_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "projects": projects,
            },
            status_code=400,
        )
    existing = await session.execute(select(Bundle.id).where(Bundle.name == name))
    if existing.scalar_one_or_none() is not None:
        return templates.TemplateResponse(
            "bundle_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Bundle already exists",
                "projects": projects,
            },
            status_code=409,
        )
    entry_rows: list[tuple[str, str, bool]] = []
    if initial_json and initial_json.strip():
        entry_rows, jerr = parse_bundle_entries_json(initial_json)
        if jerr:
            return templates.TemplateResponse(
                "bundle_new.html",
                {
                    "request": request,
                    "csrf_token": _csrf_token(request),
                    "error": jerr,
                    "projects": projects,
                },
                status_code=400,
            )
    b = Bundle(name=name, group_id=gid)
    session.add(b)
    await session.flush()
    if entry_rows:
        entry_rows = dedupe_entry_rows(
            [(normalize_env_key(k), v, s) for k, v, s in entry_rows]
        )
        await bulk_upsert_bundle_secrets(session, b.id, entry_rows)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raw = str(e.orig) if getattr(e, "orig", None) else str(e)
        tech = f"{type(e).__name__}\n{raw}\n\nSQLAlchemy:\n{str(e)[:4000]}"
        if len(tech) > 12000:
            tech = tech[:12000] + "\n…"
        low = raw.lower()
        if "bundles.name" in low or "unique constraint failed: bundles" in low:
            error_kind = "bundle_name_taken"
        elif "secrets" in low and "key_name" in low:
            error_kind = "duplicate_secret_key"
        else:
            error_kind = "other"
        kr = entry_rows or []
        names = sorted({k for k, _, _ in kr})
        dup_groups: list[dict[str, object]] = []
        if initial_json and initial_json.strip():
            try:
                parsed = json.loads(initial_json.strip())
                if isinstance(parsed, dict):
                    dup_groups = duplicate_key_groups_from_object(parsed)
            except json.JSONDecodeError:
                pass
        offending: set[str] = {g["normalized"] for g in dup_groups}
        fb_key = extract_conflicting_secret_key_name(f"{raw}\n{e}")
        if fb_key:
            offending.add(fb_key)
        key_lines = [{"name": nm, "offending": nm in offending} for nm in names]
        return templates.TemplateResponse(
            "bundle_import_error.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "title": "Could not create bundle from import",
                "summary": (
                    "The database rejected this save because a uniqueness rule was violated "
                    "(see below for the usual causes)."
                ),
                "error_kind": error_kind,
                "bundle_name": name,
                "row_count": len(kr),
                "unique_key_count": len(names),
                "key_lines": key_lines,
                "duplicate_groups": dup_groups,
                "technical_detail": tech,
            },
            status_code=400,
        )
    return RedirectResponse(
        url_path(f"/projects/{g.slug}/bundles/{name}/edit"),
        status_code=HTTP_302_FOUND,
    )


@router.get("/projects/{project_slug}/bundles/{name}", response_model=None)
async def bundle_in_project_short_url(
    request: Request,
    project_slug: str,
    name: str,
) -> RedirectResponse:
    """Convenience: /projects/.../bundles/name → .../bundles/name/edit"""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return RedirectResponse(
        url_path(f"/projects/{project_slug}/bundles/{name}/edit"),
        status_code=HTTP_302_FOUND,
    )


@router.get("/projects/{project_slug}/bundles/{name}/edit", response_class=HTMLResponse, response_model=None)
async def bundle_edit_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key: Annotated[str | None, Query()] = None,
    highlight: Annotated[str | None, Query()] = None,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_bundle_in_project(session, project_slug, name)
    base = _bundle_web_base(project_slug, name)
    return await _bundle_edit_template(
        request,
        session,
        name,
        key,
        base,
        project_slug,
        highlight,
    )


@router.get(
    "/projects/{project_slug}/bundles/{name}/env-links",
    response_class=HTMLResponse,
    response_model=None,
)
async def bundle_env_links_page_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_bundle_in_project(session, project_slug, name)
    base = _bundle_web_base(project_slug, name)
    flash_url = request.session.pop("flash_env_link_url", None)
    return await _bundle_env_links_template(
        request,
        session,
        name,
        base,
        project_slug,
        new_env_url=flash_url,
    )


@router.get("/bundles/{name}/edit", response_class=HTMLResponse, response_model=None)
async def bundle_edit_legacy(
    request: Request,
    name: str,
    key: Annotated[str | None, Query()] = None,
    highlight: Annotated[str | None, Query()] = None,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    """Ungrouped bundles only; grouped bundles redirect to /projects/{slug}/bundles/.../edit."""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_bundle_name(name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(joinedload(Bundle.group))
    )
    b = r.unique().scalar_one_or_none()
    if b is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    if b.group_id and b.group:
        dest = url_path(f"/projects/{b.group.slug}/bundles/{name}/edit")
        if request.url.query:
            dest = f"{dest}?{request.url.query}"
        return RedirectResponse(dest, status_code=HTTP_302_FOUND)
    base = _bundle_web_base(None, name)
    return await _bundle_edit_template(
        request, session, name, key, base, None, highlight
    )


@router.get("/bundles/{name}/env-links", response_class=HTMLResponse, response_model=None)
async def bundle_env_links_page_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    """Ungrouped bundles only; grouped bundles redirect to project-scoped env-links page."""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_bundle_name(name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(joinedload(Bundle.group))
    )
    b = r.unique().scalar_one_or_none()
    if b is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    if b.group_id and b.group:
        return RedirectResponse(
            url_path(f"/projects/{b.group.slug}/bundles/{name}/env-links"),
            status_code=HTTP_302_FOUND,
        )
    base = _bundle_web_base(None, name)
    flash_url = request.session.pop("flash_env_link_url", None)
    return await _bundle_env_links_template(
        request, session, name, base, None, new_env_url=flash_url
    )


async def _bundle_secret_values_encrypted_only(
    session: AsyncSession, bundle_name: str
) -> dict[str, str]:
    _, ent = await load_bundle_entries(session, bundle_name)
    return {k: v[0] for k, v in ent.items() if v[1]}


@router.get(
    "/projects/{project_slug}/bundles/{name}/secret-values",
    response_model=None,
)
@limiter.limit("120/minute")
async def bundle_secret_values_json_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_bundle_in_project(session, project_slug, name)
    payload = await _bundle_secret_values_encrypted_only(session, name)
    return JSONResponse(payload)


@router.get("/bundles/{name}/secret-values", response_model=None)
@limiter.limit("120/minute")
async def bundle_secret_values_json_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> JSONResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_bundle_ungrouped_web(session, name)
    payload = await _bundle_secret_values_encrypted_only(session, name)
    return JSONResponse(payload)


@router.post("/projects/{project_slug}/bundles/{name}/secrets/add", response_model=None)
async def bundle_secret_add_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    value: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    is_secret: Annotated[str, Form()] = "1",
    previous_key_name: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    bundle, _ = await load_bundle_entries(session, name)
    base = _bundle_web_base(project_slug, name)
    secret_flag = is_secret not in ("0", "false", "False")
    prev = previous_key_name.strip()
    try:
        nk = await upsert_bundle_secret_entry(
            session,
            bundle.id,
            key_name_input=key_name,
            value=value,
            is_secret=secret_flag,
            previous_key_name=previous_key_name or None,
        )
        await session.commit()
        return RedirectResponse(
            _bundle_edit_redirect_after_var_change(base, nk), status_code=HTTP_302_FOUND
        )
    except ValueError as err:
        await session.rollback()
        request.session["bundle_edit_error"] = str(err)
        if prev:
            return RedirectResponse(
                f"{base}/edit?key={quote(prev, safe='')}", status_code=HTTP_302_FOUND
            )
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)
    except IntegrityError:
        await session.rollback()
        request.session["bundle_edit_error"] = "Another variable already uses that name."
        if prev:
            return RedirectResponse(
                f"{base}/edit?key={quote(prev, safe='')}", status_code=HTTP_302_FOUND
            )
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/secrets/add", response_model=None)
async def bundle_secret_add_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    value: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    is_secret: Annotated[str, Form()] = "1",
    previous_key_name: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    bundle, _ = await load_bundle_entries(session, name)
    base = _bundle_web_base(None, name)
    secret_flag = is_secret not in ("0", "false", "False")
    prev = previous_key_name.strip()
    try:
        nk = await upsert_bundle_secret_entry(
            session,
            bundle.id,
            key_name_input=key_name,
            value=value,
            is_secret=secret_flag,
            previous_key_name=previous_key_name or None,
        )
        await session.commit()
        return RedirectResponse(
            _bundle_edit_redirect_after_var_change(base, nk), status_code=HTTP_302_FOUND
        )
    except ValueError as err:
        await session.rollback()
        request.session["bundle_edit_error"] = str(err)
        if prev:
            return RedirectResponse(
                f"{base}/edit?key={quote(prev, safe='')}", status_code=HTTP_302_FOUND
            )
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)
    except IntegrityError:
        await session.rollback()
        request.session["bundle_edit_error"] = "Another variable already uses that name."
        if prev:
            return RedirectResponse(
                f"{base}/edit?key={quote(prev, safe='')}", status_code=HTTP_302_FOUND
            )
        return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/bundles/{name}/secrets/encrypt", response_model=None)
async def bundle_secret_encrypt_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    await encrypt_plain_entry(session, name, key_name)
    await session.commit()
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(
        _bundle_edit_redirect_after_var_change(base, key_name), status_code=HTTP_302_FOUND
    )


@router.post("/bundles/{name}/secrets/encrypt", response_model=None)
async def bundle_secret_encrypt_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    await encrypt_plain_entry(session, name, key_name)
    await session.commit()
    base = _bundle_web_base(None, name)
    return RedirectResponse(
        _bundle_edit_redirect_after_var_change(base, key_name), status_code=HTTP_302_FOUND
    )


@router.post("/projects/{project_slug}/bundles/{name}/secrets/declassify", response_model=None)
async def bundle_secret_declassify_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    await declassify_secret_entry(session, name, key_name)
    await session.commit()
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(
        _bundle_edit_redirect_after_var_change(base, key_name), status_code=HTTP_302_FOUND
    )


@router.post("/bundles/{name}/secrets/declassify", response_model=None)
async def bundle_secret_declassify_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    await declassify_secret_entry(session, name, key_name)
    await session.commit()
    base = _bundle_web_base(None, name)
    return RedirectResponse(
        _bundle_edit_redirect_after_var_change(base, key_name), status_code=HTTP_302_FOUND
    )


@router.post("/projects/{project_slug}/bundles/{name}/secrets/delete", response_model=None)
async def bundle_secret_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    bundle, _ = await load_bundle_secrets(session, name)
    await session.execute(
        delete(Secret).where(Secret.bundle_id == bundle.id, Secret.key_name == key_name)
    )
    await session.commit()
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(f"{base}/edit", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/secrets/delete", response_model=None)
async def bundle_secret_delete_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    bundle, _ = await load_bundle_secrets(session, name)
    await session.execute(
        delete(Secret).where(Secret.bundle_id == bundle.id, Secret.key_name == key_name)
    )
    await session.commit()
    return RedirectResponse(f"{_bundle_web_base(None, name)}/edit", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/bundles/{name}/delete", response_model=None)
async def bundle_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    validate_bundle_name(name)
    await session.execute(delete(Bundle).where(Bundle.name == name))
    await session.commit()
    return RedirectResponse(
        url_path(f"/projects/{project_slug.strip()}/bundles"), status_code=HTTP_302_FOUND
    )


@router.post("/bundles/{name}/delete", response_model=None)
async def bundle_delete_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    validate_bundle_name(name)
    await session.execute(delete(Bundle).where(Bundle.name == name))
    await session.commit()
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/bundles/{name}/env-links", response_model=None)
async def bundle_env_link_create_in_project(
    request: Request,
    project_slug: str,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    bundle, _ = await load_bundle_entries(session, name)
    raw, digest = new_env_link_token()
    session.add(BundleEnvLink(bundle_id=bundle.id, token_sha256=digest))
    await session.commit()
    request.session["flash_env_link_url"] = f"{_absolute_base(request)}/env/{raw}"
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/env-links", response_model=None)
async def bundle_env_link_create_legacy(
    request: Request,
    name: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    bundle, _ = await load_bundle_entries(session, name)
    raw, digest = new_env_link_token()
    session.add(BundleEnvLink(bundle_id=bundle.id, token_sha256=digest))
    await session.commit()
    request.session["flash_env_link_url"] = f"{_absolute_base(request)}/env/{raw}"
    base = _bundle_web_base(None, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/bundles/{name}/env-links/{link_id}/delete", response_model=None)
async def bundle_env_link_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    link_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    bundle, _ = await load_bundle_entries(session, name)
    await session.execute(
        delete(BundleEnvLink).where(
            BundleEnvLink.id == link_id,
            BundleEnvLink.bundle_id == bundle.id,
        )
    )
    await session.commit()
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(f"{base}/env-links", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/env-links/{link_id}/delete", response_model=None)
async def bundle_env_link_delete_legacy(
    request: Request,
    name: str,
    link_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    bundle, _ = await load_bundle_entries(session, name)
    await session.execute(
        delete(BundleEnvLink).where(
            BundleEnvLink.id == link_id,
            BundleEnvLink.bundle_id == bundle.id,
        )
    )
    await session.commit()
    return RedirectResponse(f"{_bundle_web_base(None, name)}/env-links", status_code=HTTP_302_FOUND)


@router.get(
    "/projects/{project_slug}/bundles/{name}/sealed-secrets",
    response_class=HTMLResponse,
    response_model=None,
)
async def bundle_sealed_secrets_page_in_project(
    request: Request,
    project_slug: str,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    await _validate_bundle_in_project(session, project_slug, name)
    base = _bundle_web_base(project_slug, name)
    return await _bundle_sealed_secrets_template(
        request,
        session,
        name,
        base,
        project_slug,
    )


@router.get(
    "/bundles/{name}/sealed-secrets",
    response_class=HTMLResponse,
    response_model=None,
)
async def bundle_sealed_secrets_page_legacy(
    request: Request,
    name: str,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    validate_bundle_name(name)
    r = await session.execute(
        select(Bundle).where(Bundle.name == name).options(joinedload(Bundle.group))
    )
    b = r.unique().scalar_one_or_none()
    if b is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    if b.group_id and b.group:
        return RedirectResponse(
            url_path(f"/projects/{b.group.slug}/bundles/{name}/sealed-secrets"),
            status_code=HTTP_302_FOUND,
        )
    base = _bundle_web_base(None, name)
    return await _bundle_sealed_secrets_template(request, session, name, base, None)


@router.post(
    "/projects/{project_slug}/bundles/{name}/sealed-secrets/add",
    response_model=None,
)
async def bundle_sealed_secret_add_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    enc_alg: Annotated[str, Form()],
    payload_ciphertext: Annotated[str, Form()],
    payload_nonce: Annotated[str, Form()],
    payload_aad: Annotated[str, Form()] = "",
    recipients_json: Annotated[str, Form()] = "",
    csrf: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    base = _bundle_web_base(project_slug, name)
    bundle_r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bundle_id = bundle_r.scalar_one_or_none()
    if bundle_id is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    normalized_key = normalize_env_key(key_name)
    if not normalized_key:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            project_slug,
            error="Key name is required",
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    recipients, recipients_err = _parse_recipients_json(recipients_json)
    if recipients_err:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            project_slug,
            error=recipients_err,
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    cert_ids = [int(x["certificate_id"]) for x in recipients]
    cert_r = await session.execute(select(Certificate.id).where(Certificate.id.in_(cert_ids)))
    found = {int(row[0]) for row in cert_r.all()}
    missing = [str(cid) for cid in cert_ids if cid not in found]
    if missing:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            project_slug,
            error=f"Unknown certificate IDs: {', '.join(missing)}",
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    row_r = await session.execute(
        select(SealedSecret)
        .where(SealedSecret.bundle_id == bundle_id, SealedSecret.key_name == normalized_key)
        .options(joinedload(SealedSecret.recipients))
    )
    row = row_r.unique().scalar_one_or_none()
    if row is None:
        row = SealedSecret(
            bundle_id=bundle_id,
            key_name=normalized_key,
            enc_alg=(enc_alg or "aes-256-gcm").strip() or "aes-256-gcm",
            payload_ciphertext=payload_ciphertext.strip(),
            payload_nonce=payload_nonce.strip(),
            payload_aad=payload_aad.strip() or None,
        )
        session.add(row)
        await session.flush()
    else:
        row.enc_alg = (enc_alg or "aes-256-gcm").strip() or "aes-256-gcm"
        row.payload_ciphertext = payload_ciphertext.strip()
        row.payload_nonce = payload_nonce.strip()
        row.payload_aad = payload_aad.strip() or None
        await session.execute(
            delete(SealedSecretRecipient).where(SealedSecretRecipient.sealed_secret_id == row.id)
        )
    for rec in recipients:
        session.add(
            SealedSecretRecipient(
                sealed_secret_id=row.id,
                certificate_id=int(rec["certificate_id"]),
                wrapped_key=str(rec["wrapped_key"]),
                key_wrap_alg=str(rec["key_wrap_alg"]),
            )
        )
    await session.commit()
    return RedirectResponse(f"{base}/sealed-secrets", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/sealed-secrets/add", response_model=None)
async def bundle_sealed_secret_add_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    enc_alg: Annotated[str, Form()],
    payload_ciphertext: Annotated[str, Form()],
    payload_nonce: Annotated[str, Form()],
    payload_aad: Annotated[str, Form()] = "",
    recipients_json: Annotated[str, Form()] = "",
    csrf: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    base = _bundle_web_base(None, name)
    bundle_r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bundle_id = bundle_r.scalar_one_or_none()
    if bundle_id is None:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "Bundle not found"},
            status_code=404,
        )
    normalized_key = normalize_env_key(key_name)
    if not normalized_key:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            None,
            error="Key name is required",
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    recipients, recipients_err = _parse_recipients_json(recipients_json)
    if recipients_err:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            None,
            error=recipients_err,
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    cert_ids = [int(x["certificate_id"]) for x in recipients]
    cert_r = await session.execute(select(Certificate.id).where(Certificate.id.in_(cert_ids)))
    found = {int(row[0]) for row in cert_r.all()}
    missing = [str(cid) for cid in cert_ids if cid not in found]
    if missing:
        return await _bundle_sealed_secrets_template(
            request,
            session,
            name,
            base,
            None,
            error=f"Unknown certificate IDs: {', '.join(missing)}",
            form_values={
                "key_name": key_name,
                "enc_alg": enc_alg,
                "payload_ciphertext": payload_ciphertext,
                "payload_nonce": payload_nonce,
                "payload_aad": payload_aad,
                "recipients_json": recipients_json,
            },
        )
    row_r = await session.execute(
        select(SealedSecret)
        .where(SealedSecret.bundle_id == bundle_id, SealedSecret.key_name == normalized_key)
        .options(joinedload(SealedSecret.recipients))
    )
    row = row_r.unique().scalar_one_or_none()
    if row is None:
        row = SealedSecret(
            bundle_id=bundle_id,
            key_name=normalized_key,
            enc_alg=(enc_alg or "aes-256-gcm").strip() or "aes-256-gcm",
            payload_ciphertext=payload_ciphertext.strip(),
            payload_nonce=payload_nonce.strip(),
            payload_aad=payload_aad.strip() or None,
        )
        session.add(row)
        await session.flush()
    else:
        row.enc_alg = (enc_alg or "aes-256-gcm").strip() or "aes-256-gcm"
        row.payload_ciphertext = payload_ciphertext.strip()
        row.payload_nonce = payload_nonce.strip()
        row.payload_aad = payload_aad.strip() or None
        await session.execute(
            delete(SealedSecretRecipient).where(SealedSecretRecipient.sealed_secret_id == row.id)
        )
    for rec in recipients:
        session.add(
            SealedSecretRecipient(
                sealed_secret_id=row.id,
                certificate_id=int(rec["certificate_id"]),
                wrapped_key=str(rec["wrapped_key"]),
                key_wrap_alg=str(rec["key_wrap_alg"]),
            )
        )
    await session.commit()
    return RedirectResponse(f"{base}/sealed-secrets", status_code=HTTP_302_FOUND)


@router.post(
    "/projects/{project_slug}/bundles/{name}/sealed-secrets/delete",
    response_model=None,
)
async def bundle_sealed_secret_delete_in_project(
    request: Request,
    project_slug: str,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_in_project(session, project_slug, name)
    bundle_r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bundle_id = bundle_r.scalar_one_or_none()
    if bundle_id is not None:
        await session.execute(
            delete(SealedSecret).where(
                SealedSecret.bundle_id == bundle_id,
                SealedSecret.key_name == normalize_env_key(key_name),
            )
        )
        await session.commit()
    base = _bundle_web_base(project_slug, name)
    return RedirectResponse(f"{base}/sealed-secrets", status_code=HTTP_302_FOUND)


@router.post("/bundles/{name}/sealed-secrets/delete", response_model=None)
async def bundle_sealed_secret_delete_legacy(
    request: Request,
    name: str,
    key_name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await _validate_bundle_ungrouped_web(session, name)
    bundle_r = await session.execute(select(Bundle.id).where(Bundle.name == name))
    bundle_id = bundle_r.scalar_one_or_none()
    if bundle_id is not None:
        await session.execute(
            delete(SealedSecret).where(
                SealedSecret.bundle_id == bundle_id,
                SealedSecret.key_name == normalize_env_key(key_name),
            )
        )
        await session.commit()
    return RedirectResponse(f"{_bundle_web_base(None, name)}/sealed-secrets", status_code=HTTP_302_FOUND)


@router.get("/certificates", response_class=HTMLResponse, response_model=None)
async def certificates_page(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return await _certificates_template(request, session)


@router.post("/certificates/new", response_model=None)
async def certificates_new(
    request: Request,
    name: Annotated[str, Form()],
    certificate_pem: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    clean_name = name.strip()
    clean_pem = certificate_pem.strip()
    if not clean_name:
        return await _certificates_template(
            request,
            session,
            error="Certificate name is required",
            form_name=clean_name,
            form_certificate_pem=clean_pem,
        )
    if not clean_pem:
        return await _certificates_template(
            request,
            session,
            error="Certificate PEM is required",
            form_name=clean_name,
            form_certificate_pem=clean_pem,
        )
    try:
        fingerprint = _certificate_fingerprint_sha256_hex(clean_pem)
    except HTTPException as e:
        return await _certificates_template(
            request,
            session,
            error=str(e.detail),
            form_name=clean_name,
            form_certificate_pem=clean_pem,
        )
    existing = await session.execute(
        select(Certificate.id).where(
            (Certificate.name == clean_name) | (Certificate.fingerprint_sha256 == fingerprint)
        )
    )
    if existing.scalar_one_or_none() is not None:
        return await _certificates_template(
            request,
            session,
            error="Certificate with this name or fingerprint already exists",
            form_name=clean_name,
            form_certificate_pem=clean_pem,
        )
    session.add(
        Certificate(
            name=clean_name,
            fingerprint_sha256=fingerprint,
            certificate_pem=clean_pem,
        )
    )
    await session.commit()
    return RedirectResponse(url_path("/certificates"), status_code=HTTP_302_FOUND)


@router.post("/certificates/{certificate_id}/delete", response_model=None)
async def certificates_delete(
    request: Request,
    certificate_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    in_use = await session.execute(
        select(SealedSecretRecipient.id)
        .where(SealedSecretRecipient.certificate_id == certificate_id)
        .limit(1)
    )
    if in_use.scalar_one_or_none() is not None:
        return await _certificates_template(
            request,
            session,
            error="Certificate is in use by sealed secrets and cannot be deleted",
        )
    await session.execute(delete(Certificate).where(Certificate.id == certificate_id))
    await session.commit()
    return RedirectResponse(url_path("/certificates"), status_code=HTTP_302_FOUND)


@router.get("/keys", response_class=HTMLResponse, response_model=None)
async def keys_list(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    r = await session.execute(select(ApiKey).order_by(ApiKey.id))
    keys = r.scalars().all()
    new_plain = request.session.pop("new_plain_key", None)
    ctx = await _keys_template_context(
        session,
        request,
        keys=keys,
        csrf_token=_csrf_token(request),
        new_plain_key=new_plain,
        scopes_json_value='["read:bundle:*"]',
    )
    return templates.TemplateResponse("keys.html", ctx)


@router.post("/keys/new", response_model=None)
async def keys_new(
    request: Request,
    name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    scopes_json: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    name = name.strip()
    raw = scopes_json.strip() if scopes_json.strip() else ""
    if not raw:
        raw = '["read:bundle:*"]'
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("not a list")
        scopes_list = [str(x).strip() for x in parsed if str(x).strip()]
        validate_scopes_list(scopes_list)
    except HTTPException as e:
        detail = e.detail
        r = await session.execute(select(ApiKey).order_by(ApiKey.id))
        ctx = await _keys_template_context(
            session,
            request,
            keys=r.scalars().all(),
            csrf_token=_csrf_token(request),
            scopes_error=detail,
            scopes_json_value=raw,
        )
        return templates.TemplateResponse("keys.html", ctx, status_code=400)
    except (json.JSONDecodeError, ValueError) as e:
        detail = "Invalid scopes JSON (expect a non-empty array of strings)"
        r = await session.execute(select(ApiKey).order_by(ApiKey.id))
        ctx = await _keys_template_context(
            session,
            request,
            keys=r.scalars().all(),
            csrf_token=_csrf_token(request),
            scopes_error=detail,
            scopes_json_value=raw,
        )
        return templates.TemplateResponse("keys.html", ctx, status_code=400)
    plain = generate_raw_api_key()
    row = ApiKey(
        name=name,
        key_hash=hash_api_key(plain),
        scopes=scopes_to_json(scopes_list),
    )
    session.add(row)
    await session.commit()
    request.session["new_plain_key"] = plain
    return RedirectResponse(url_path("/keys"), status_code=HTTP_302_FOUND)


@router.post("/keys/{key_id}/delete", response_model=None)
async def keys_delete(
    request: Request,
    key_id: int,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    await session.execute(delete(ApiKey).where(ApiKey.id == key_id))
    await session.commit()
    return RedirectResponse(url_path("/keys"), status_code=HTTP_302_FOUND)


@router.get("/groups", response_model=None)
async def legacy_groups_to_projects() -> RedirectResponse:
    """Old URL; use /projects."""
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.get("/groups/new", response_model=None)
async def legacy_groups_new_to_projects_new() -> RedirectResponse:
    return RedirectResponse(url_path("/projects/new"), status_code=HTTP_302_FOUND)


@router.get("/projects", response_class=HTMLResponse, response_model=None)
async def projects_page(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    r = await session.execute(
        select(
            BundleGroup.id,
            BundleGroup.name,
            BundleGroup.slug,
            func.count(Bundle.id).label("n"),
        )
        .select_from(BundleGroup)
        .outerjoin(Bundle, Bundle.group_id == BundleGroup.id)
        .group_by(BundleGroup.id, BundleGroup.name, BundleGroup.slug)
        .order_by(BundleGroup.name)
    )
    projects = [
        {
            "id": row.id,
            "name": row.name,
            "slug": row.slug,
            "bundle_count": int(row.n),
        }
        for row in r.all()
    ]
    return templates.TemplateResponse(
        "projects_list.html",
        {"request": request, "projects": projects, "csrf_token": _csrf_token(request)},
    )


@router.get("/projects/new", response_class=HTMLResponse, response_model=None)
async def projects_new_get(request: Request) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    return templates.TemplateResponse(
        "project_new.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "error": None,
            "name_value": "",
            "slug_value": "",
        },
    )


@router.post("/projects/new", response_model=None)
async def projects_new_post(
    request: Request,
    name: Annotated[str, Form()],
    csrf: Annotated[str, Form()],
    slug: Annotated[str, Form()] = "",
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    raw = name.strip()
    try:
        validate_project_name(raw)
    except HTTPException as e:
        return templates.TemplateResponse(
            "project_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": e.detail,
                "name_value": raw,
                "slug_value": slug.strip(),
            },
            status_code=400,
        )
    existing = await session.execute(
        select(BundleGroup.id).where(BundleGroup.name == raw)
    )
    if existing.scalar_one_or_none() is not None:
        return templates.TemplateResponse(
            "project_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "A project with that name already exists",
                "name_value": raw,
                "slug_value": slug.strip(),
            },
            status_code=409,
        )
    slug_raw = slug.strip()
    if slug_raw:
        try:
            validate_project_slug(slug_raw)
        except HTTPException as e:
            return templates.TemplateResponse(
                "project_new.html",
                {
                    "request": request,
                    "csrf_token": _csrf_token(request),
                    "error": e.detail,
                    "name_value": raw,
                    "slug_value": slug_raw,
                },
                status_code=400,
            )
        taken = await session.execute(
            select(BundleGroup.id).where(BundleGroup.slug == slug_raw)
        )
        if taken.scalar_one_or_none() is not None:
            return templates.TemplateResponse(
                "project_new.html",
                {
                    "request": request,
                    "csrf_token": _csrf_token(request),
                    "error": "A project with that slug already exists",
                    "name_value": raw,
                    "slug_value": slug_raw,
                },
                status_code=409,
            )
        final_slug = slug_raw
    else:
        base = slug_suggestion_from_name(raw)
        validate_project_slug(base)
        final_slug = await next_available_slug(session, base)

    session.add(BundleGroup(name=raw, slug=final_slug))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return templates.TemplateResponse(
            "project_new.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "error": "Could not save (name or slug may already exist)",
                "name_value": raw,
                "slug_value": slug.strip(),
            },
            status_code=409,
        )
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


@router.post("/projects/{project_slug}/delete", response_model=None)
async def projects_delete(
    request: Request,
    project_slug: str,
    csrf: Annotated[str, Form()],
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    r = await session.execute(delete(BundleGroup).where(BundleGroup.slug == project_slug.strip()))
    if r.rowcount == 0:
        return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)
    await session.commit()
    return RedirectResponse(url_path("/projects"), status_code=HTTP_302_FOUND)


def _backup_download_filename(prefix: str, ext: str) -> str:
    d = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}-{d}.{ext}"


@router.get("/backup", response_class=HTMLResponse, response_model=None)
async def backup_page(
    request: Request,
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    settings = get_settings()
    sqlite_ok = database_url_to_sqlite_path(settings.database_url) is not None
    return templates.TemplateResponse(
        "backup.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "backup_enabled": settings.backup_enabled and sqlite_ok,
            "restore_enabled": settings.restore_enabled and sqlite_ok,
            "sqlite_ok": sqlite_ok,
        },
    )


@router.post("/backup/download-raw", response_model=None)
@limiter.limit("60/hour")
async def backup_download_raw(
    request: Request,
    csrf: Annotated[str, Form()],
) -> Response | RedirectResponse:
    """POST only — do not register GET on the same path (breaks multipart/method routing in some stacks)."""
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    settings = get_settings()
    if not settings.backup_enabled or database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(status_code=403, detail="Backup disabled or not a file SQLite database")
    data = await snapshot_sqlite_bytes()
    fn = _backup_download_filename("envelope", "db")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{fn}"',
            "Content-Length": str(len(data)),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/backup/download-encrypted", response_model=None)
@limiter.limit("60/hour")
async def backup_download_encrypted(
    request: Request,
    csrf: Annotated[str, Form()],
    passphrase: Annotated[str, Form()],
) -> Response | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    settings = get_settings()
    if not settings.backup_enabled or database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(status_code=403, detail="Backup disabled or not a file SQLite database")
    pp = passphrase.strip()
    if not pp:
        raise HTTPException(status_code=400, detail="passphrase required")
    raw = await snapshot_sqlite_bytes()
    try:
        enc = await encrypt_bytes_async(raw, pp)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    fn = _backup_download_filename("envelope", "envelope-db")
    return Response(
        content=enc,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{fn}"',
            "Content-Length": str(len(enc)),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/backup/restore", response_model=None)
@limiter.limit("6/hour")
async def backup_restore(
    request: Request,
    csrf: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    passphrase: Annotated[str, Form()] = "",
) -> HTMLResponse | RedirectResponse:
    if (redir := _require_web_admin(request)) is not None:
        return redir
    _check_csrf(request, csrf)
    settings = get_settings()
    if not settings.restore_enabled or database_url_to_sqlite_path(settings.database_url) is None:
        raise HTTPException(status_code=403, detail="Restore disabled or not a file SQLite database")
    raw_bytes = await file.read()
    if not raw_bytes:
        return templates.TemplateResponse(
            "backup.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "backup_enabled": settings.backup_enabled,
                "restore_enabled": True,
                "sqlite_ok": True,
                "restore_error": "Empty file",
            },
            status_code=400,
        )
    content = raw_bytes
    if passphrase.strip():
        try:
            content = decrypt_bytes(raw_bytes, passphrase.strip())
        except WrongPassphraseError as e:
            return templates.TemplateResponse(
                "backup.html",
                {
                    "request": request,
                    "csrf_token": _csrf_token(request),
                    "backup_enabled": settings.backup_enabled,
                    "restore_enabled": True,
                    "sqlite_ok": True,
                    "restore_error": str(e),
                },
                status_code=400,
            )
        except Exception as e:
            return templates.TemplateResponse(
                "backup.html",
                {
                    "request": request,
                    "csrf_token": _csrf_token(request),
                    "backup_enabled": settings.backup_enabled,
                    "restore_enabled": True,
                    "sqlite_ok": True,
                    "restore_error": str(e),
                },
                status_code=400,
            )
    try:
        await replace_sqlite_database(new_content=content)
    except ValueError as e:
        return templates.TemplateResponse(
            "backup.html",
            {
                "request": request,
                "csrf_token": _csrf_token(request),
                "backup_enabled": settings.backup_enabled,
                "restore_enabled": True,
                "sqlite_ok": True,
                "restore_error": str(e),
            },
            status_code=400,
        )
    return templates.TemplateResponse(
        "backup.html",
        {
            "request": request,
            "csrf_token": _csrf_token(request),
            "backup_enabled": settings.backup_enabled,
            "restore_enabled": True,
            "sqlite_ok": True,
            "restore_ok": True,
        },
    )
