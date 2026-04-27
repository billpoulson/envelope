from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.resource_scope import ResourcePathScope
from app.api.v1.bundles import (
    CreateBundleBody,
    PatchBundleBody,
    UpsertSecretBody,
    create_bundle,
    delete_secret,
    export_bundle,
    get_bundle_decrypted,
    list_bundles,
    patch_bundle,
    upsert_secret,
)
from app.api.v1.projects import list_project_environments, list_projects
from app.api.v1.stacks import (
    CreateStackBody,
    PatchStackBody,
    create_stack,
    export_stack,
    get_stack,
    list_stacks,
    patch_stack,
)
from app.config import get_settings
from app.db import get_session_factory
from app.deps import get_fernet
from app.models import ApiKey, BundleGroup, McpApprovalRequest
from app.services.audit import emit_audit_event
from app.services.projects import get_project_by_slug_or_404
from app.services.scope_resolution import fetch_bundle_for_path, fetch_stack_for_path
from app.services.scopes import (
    can_create_bundle,
    can_create_stack,
    can_write_bundle,
    can_write_stack,
    parse_scopes_json,
)

MCP_PROTOCOL_VERSION = "2025-03-26"
PENDING = "pending"
DENIED = "denied"
EXECUTED = "executed"
FAILED = "failed"

WRITE_TOOL_NAMES = {
    "request_create_bundle",
    "request_update_bundle",
    "request_upsert_bundle_variable",
    "request_delete_bundle_variable",
    "request_create_stack",
    "request_update_stack",
}


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _json_loads_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _resource_scope(args: dict[str, Any]) -> ResourcePathScope:
    return ResourcePathScope(
        project_slug=args.get("project_slug"),
        environment_slug=args.get("environment_slug"),
    )


def _sanitize_args(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, child in value.items():
            k = str(key)
            if k in {"value", "entries", "initial_paste", "passphrase"}:
                out[k] = "[redacted]"
            else:
                out[k] = _sanitize_args(child)
        return out
    if isinstance(value, list):
        return [_sanitize_args(x) for x in value]
    return value


def _approval_row(row: McpApprovalRequest) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "status": row.status,
        "tool_name": row.tool_name,
        "arguments": _json_loads_dict(row.sanitized_arguments_json),
        "requester_api_key_id": row.requester_api_key_id,
        "requester_api_key_name": row.requester_api_key_name,
        "resource_type": row.resource_type,
        "resource_name": row.resource_name,
        "project_slug": row.project_slug,
        "environment_slug": row.environment_slug,
        "decision_admin_api_key_id": row.decision_admin_api_key_id,
        "decision_admin_api_key_name": row.decision_admin_api_key_name,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decision_note": row.decision_note,
        "result": _json_loads_dict(row.result_json),
        "error": row.error,
    }


def _encrypt_args(args: dict[str, Any]) -> bytes:
    return get_fernet().encrypt(_json_dumps(args).encode("utf-8"))


def _decrypt_args(row: McpApprovalRequest) -> dict[str, Any]:
    raw = get_fernet().decrypt(row.arguments_encrypted).decode("utf-8")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Stored MCP approval arguments are invalid")
    return parsed


def _project_meta(group: BundleGroup | None) -> tuple[str | None, str | None]:
    if group is None:
        return None, None
    return group.name, group.slug


async def _require_create_bundle_scope(
    session: AsyncSession, key: ApiKey, args: dict[str, Any]
) -> None:
    name = str(args.get("name") or "").strip()
    slug = str(args.get("slug") or "").strip() or None
    project_slug = str(args.get("project_slug") or "").strip()
    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    group = await get_project_by_slug_or_404(session, project_slug)
    if not can_create_bundle(
        parse_scopes_json(key.scopes),
        bundle_name=name,
        bundle_slug=slug,
        group_id=group.id,
        project_name=group.name,
        project_slug=group.slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this bundle")


async def _require_write_bundle_scope(
    session: AsyncSession, key: ApiKey, args: dict[str, Any]
) -> None:
    name = str(args.get("bundle") or args.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="bundle is required")
    scope = _resource_scope(args)
    bundle = await fetch_bundle_for_path(
        session,
        name,
        project_slug=scope.project_slug,
        environment_slug=scope.environment_slug,
    )
    project_name, project_slug = _project_meta(bundle.group)
    if not can_write_bundle(
        parse_scopes_json(key.scopes),
        bundle_name=bundle.name,
        bundle_slug=bundle.slug,
        group_id=bundle.group_id,
        project_name=project_name,
        project_slug=project_slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this bundle")


async def _require_create_stack_scope(
    session: AsyncSession, key: ApiKey, args: dict[str, Any]
) -> None:
    name = str(args.get("name") or "").strip()
    slug = str(args.get("slug") or "").strip() or None
    project_slug = str(args.get("project_slug") or "").strip()
    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    group = await get_project_by_slug_or_404(session, project_slug)
    if not can_create_stack(
        parse_scopes_json(key.scopes),
        stack_name=name,
        stack_slug=slug,
        group_id=group.id,
        project_name=group.name,
        project_slug=group.slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope to create this stack")


async def _require_write_stack_scope(
    session: AsyncSession, key: ApiKey, args: dict[str, Any]
) -> None:
    name = str(args.get("stack") or args.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="stack is required")
    scope = _resource_scope(args)
    stack = await fetch_stack_for_path(
        session,
        name,
        project_slug=scope.project_slug,
        environment_slug=scope.environment_slug,
    )
    project_name, project_slug = _project_meta(stack.group)
    if not can_write_stack(
        parse_scopes_json(key.scopes),
        stack_name=stack.name,
        stack_slug=stack.slug,
        group_id=stack.group_id,
        project_name=project_name,
        project_slug=project_slug,
    ):
        raise HTTPException(status_code=403, detail="Insufficient scope for this stack")


async def _validate_write_request(session: AsyncSession, key: ApiKey, tool_name: str, args: dict[str, Any]) -> None:
    if tool_name == "request_create_bundle":
        CreateBundleBody(**args)
        await _require_create_bundle_scope(session, key, args)
    elif tool_name in {
        "request_update_bundle",
        "request_upsert_bundle_variable",
        "request_delete_bundle_variable",
    }:
        await _require_write_bundle_scope(session, key, args)
    elif tool_name == "request_create_stack":
        CreateStackBody(**args)
        await _require_create_stack_scope(session, key, args)
    elif tool_name == "request_update_stack":
        await _require_write_stack_scope(session, key, args)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown write tool: {tool_name}")


async def create_approval_request(
    session: AsyncSession,
    request: Request,
    key: ApiKey,
    tool_name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    await _validate_write_request(session, key, tool_name, args)
    resource_type = "bundle" if "bundle" in tool_name else "stack"
    resource_name = str(args.get("bundle") or args.get("stack") or args.get("name") or "").strip() or None
    row = McpApprovalRequest(
        status=PENDING,
        tool_name=tool_name,
        arguments_encrypted=_encrypt_args(args),
        sanitized_arguments_json=_json_dumps(_sanitize_args(args)),
        requester_api_key_id=key.id,
        requester_api_key_name=key.name,
        requester_scopes_json=key.scopes,
        resource_type=resource_type,
        resource_name=resource_name,
        project_slug=args.get("project_slug"),
        environment_slug=args.get("environment_slug") or args.get("project_environment_slug"),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await emit_audit_event(
        session,
        request,
        event_type="mcp.approval_requested",
        actor=key,
        details={"approval_id": row.id, "tool_name": tool_name, "arguments": _sanitize_args(args)},
    )
    return _approval_row(row)


async def list_approval_requests(
    session: AsyncSession, status: str | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    stmt = select(McpApprovalRequest).order_by(McpApprovalRequest.id.desc()).limit(limit)
    if status:
        stmt = stmt.where(McpApprovalRequest.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return [_approval_row(row) for row in rows]


async def get_approval_request(session: AsyncSession, approval_id: int) -> dict[str, Any]:
    row = await session.get(McpApprovalRequest, approval_id)
    if row is None:
        raise HTTPException(status_code=404, detail="MCP approval request not found")
    return _approval_row(row)


async def deny_approval_request(
    session: AsyncSession,
    request: Request,
    approval_id: int,
    admin: ApiKey,
    note: str | None,
) -> dict[str, Any]:
    row = await session.get(McpApprovalRequest, approval_id)
    if row is None:
        raise HTTPException(status_code=404, detail="MCP approval request not found")
    if row.status != PENDING:
        raise HTTPException(status_code=409, detail="MCP approval request is no longer pending")
    now = datetime.now(timezone.utc)
    row.status = DENIED
    row.decision_admin_api_key_id = admin.id
    row.decision_admin_api_key_name = admin.name
    row.decided_at = now
    row.updated_at = now
    row.decision_note = note.strip() if note else None
    await session.commit()
    await session.refresh(row)
    await emit_audit_event(
        session,
        request,
        event_type="mcp.approval_denied",
        actor=admin,
        details={"approval_id": row.id, "tool_name": row.tool_name},
    )
    return _approval_row(row)


async def _load_requester(session: AsyncSession, row: McpApprovalRequest) -> ApiKey:
    if row.requester_api_key_id is None:
        raise HTTPException(status_code=400, detail="Requester API key no longer exists")
    requester = await session.get(ApiKey, row.requester_api_key_id)
    if requester is None:
        raise HTTPException(status_code=400, detail="Requester API key no longer exists")
    return requester


async def _execute_approved_tool(
    session: AsyncSession, request: Request, row: McpApprovalRequest, requester: ApiKey
) -> Any:
    args = _decrypt_args(row)
    if row.tool_name == "request_create_bundle":
        return await create_bundle(CreateBundleBody(**args), key=requester, session=session)
    if row.tool_name == "request_update_bundle":
        bundle = str(args.pop("bundle", "")).strip()
        scope = _resource_scope(args)
        return await patch_bundle(
            bundle,
            PatchBundleBody(**args),
            scope=scope,
            key=requester,
            session=session,
        )
    if row.tool_name == "request_upsert_bundle_variable":
        bundle = str(args.get("bundle") or "").strip()
        scope = _resource_scope(args)
        return await upsert_secret(
            bundle,
            UpsertSecretBody(
                key_name=str(args.get("key_name") or ""),
                value=str(args.get("value") or ""),
                is_secret=bool(args.get("is_secret", True)),
            ),
            scope=scope,
            auth=requester,
            session=session,
        )
    if row.tool_name == "request_delete_bundle_variable":
        bundle = str(args.get("bundle") or "").strip()
        scope = _resource_scope(args)
        return await delete_secret(
            bundle,
            key_name=str(args.get("key_name") or ""),
            scope=scope,
            auth=requester,
            session=session,
        )
    if row.tool_name == "request_create_stack":
        return await create_stack(CreateStackBody(**args), key=requester, session=session)
    if row.tool_name == "request_update_stack":
        stack = str(args.pop("stack", "")).strip()
        scope = _resource_scope(args)
        return await patch_stack(
            stack,
            PatchStackBody(**args),
            scope=scope,
            key=requester,
            session=session,
        )
    raise HTTPException(status_code=400, detail=f"Unknown write tool: {row.tool_name}")


def _serializable_result(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    status_code = getattr(value, "status_code", None)
    if status_code is not None:
        return {"status_code": status_code}
    if isinstance(value, dict):
        return value
    return {"result": str(value)}


async def approve_approval_request(
    session: AsyncSession,
    request: Request,
    approval_id: int,
    admin: ApiKey,
    note: str | None,
) -> dict[str, Any]:
    row = await session.get(McpApprovalRequest, approval_id)
    if row is None:
        raise HTTPException(status_code=404, detail="MCP approval request not found")
    if row.status != PENDING:
        raise HTTPException(status_code=409, detail="MCP approval request is no longer pending")
    requester = await _load_requester(session, row)
    now = datetime.now(timezone.utc)
    row.decision_admin_api_key_id = admin.id
    row.decision_admin_api_key_name = admin.name
    row.decided_at = now
    row.updated_at = now
    row.decision_note = note.strip() if note else None
    try:
        value = await _execute_approved_tool(session, request, row, requester)
        row.status = EXECUTED
        row.result_json = _json_dumps(_serializable_result(value))
        row.error = None
    except Exception as exc:
        row.status = FAILED
        row.error = str(getattr(exc, "detail", None) or exc)
    await session.commit()
    await session.refresh(row)
    await emit_audit_event(
        session,
        request,
        event_type="mcp.approval_executed" if row.status == EXECUTED else "mcp.approval_failed",
        actor=admin,
        details={
            "approval_id": row.id,
            "tool_name": row.tool_name,
            "status": row.status,
            "error": row.error,
        },
    )
    return _approval_row(row)


def mcp_tool_definitions() -> list[dict[str, Any]]:
    object_schema = {"type": "object", "additionalProperties": True}
    return [
        {"name": "list_projects", "description": "List Envelope projects visible to the API key.", "inputSchema": object_schema},
        {"name": "list_environments", "description": "List environments for a project.", "inputSchema": {"type": "object", "properties": {"project_slug": {"type": "string"}}, "required": ["project_slug"]}},
        {"name": "list_bundles", "description": "List bundles, optionally scoped to a project environment.", "inputSchema": object_schema},
        {"name": "list_stacks", "description": "List stacks, optionally scoped to a project environment.", "inputSchema": object_schema},
        {"name": "get_bundle", "description": "Inspect a bundle. Secret values are masked unless include_secret_values is true.", "inputSchema": object_schema},
        {"name": "export_bundle_env", "description": "Export bundle values as dotenv or json.", "inputSchema": object_schema},
        {"name": "get_stack", "description": "Inspect a stack and its layers.", "inputSchema": object_schema},
        {"name": "export_stack_env", "description": "Export merged stack values as dotenv or json.", "inputSchema": object_schema},
        {"name": "request_create_bundle", "description": "Request approval to create a bundle.", "inputSchema": object_schema},
        {"name": "request_update_bundle", "description": "Request approval to update bundle metadata or entries.", "inputSchema": object_schema},
        {"name": "request_upsert_bundle_variable", "description": "Request approval to upsert one bundle variable.", "inputSchema": object_schema},
        {"name": "request_delete_bundle_variable", "description": "Request approval to delete one bundle variable.", "inputSchema": object_schema},
        {"name": "request_create_stack", "description": "Request approval to create a stack.", "inputSchema": object_schema},
        {"name": "request_update_stack", "description": "Request approval to update a stack.", "inputSchema": object_schema},
        {"name": "approval_status", "description": "Get the current status of an MCP approval request.", "inputSchema": {"type": "object", "properties": {"approval_id": {"type": "integer"}}, "required": ["approval_id"]}},
    ]


async def call_mcp_tool(
    session: AsyncSession,
    request: Request,
    key: ApiKey,
    tool_name: str,
    args: dict[str, Any] | None,
) -> Any:
    args = dict(args or {})
    if tool_name == "list_projects":
        return await list_projects(key=key, session=session)
    if tool_name == "list_environments":
        return await list_project_environments(
            project_slug=str(args.get("project_slug") or ""),
            key=key,
            session=session,
        )
    if tool_name == "list_bundles":
        return await list_bundles(
            project_slug=args.get("project_slug"),
            environment_slug=args.get("environment_slug"),
            include_unassigned=False,
            with_environment=bool(args.get("with_environment", True)),
            key=key,
            session=session,
        )
    if tool_name == "list_stacks":
        return await list_stacks(
            project_slug=args.get("project_slug"),
            environment_slug=args.get("environment_slug"),
            include_unassigned=False,
            with_environment=bool(args.get("with_environment", True)),
            key=key,
            session=session,
        )
    if tool_name == "get_bundle":
        scope = _resource_scope(args)
        return await get_bundle_decrypted(
            str(args.get("bundle") or args.get("name") or ""),
            request=request,
            scope=scope,
            include_secret_values=bool(args.get("include_secret_values", False)),
            key=key,
            session=session,
        )
    if tool_name == "export_bundle_env":
        scope = _resource_scope(args)
        response = await export_bundle(
            request=request,
            name=str(args.get("bundle") or args.get("name") or ""),
            scope=scope,
            format=str(args.get("format") or "dotenv"),
            key=key,
            session=session,
        )
        body = response.body.decode("utf-8") if hasattr(response, "body") else ""
        return {"format": args.get("format") or "dotenv", "body": body}
    if tool_name == "get_stack":
        scope = _resource_scope(args)
        return await get_stack(
            str(args.get("stack") or args.get("name") or ""),
            scope=scope,
            key=key,
            session=session,
        )
    if tool_name == "export_stack_env":
        scope = _resource_scope(args)
        response = await export_stack(
            request=request,
            name=str(args.get("stack") or args.get("name") or ""),
            scope=scope,
            format=str(args.get("format") or "dotenv"),
            key=key,
            session=session,
        )
        body = response.body.decode("utf-8") if hasattr(response, "body") else ""
        return {"format": args.get("format") or "dotenv", "body": body}
    if tool_name in WRITE_TOOL_NAMES:
        return await create_approval_request(session, request, key, tool_name, args)
    if tool_name == "approval_status":
        return await get_approval_request(session, int(args.get("approval_id")))
    raise HTTPException(status_code=404, detail=f"Unknown MCP tool: {tool_name}")


def mcp_status_payload() -> dict[str, Any]:
    settings = get_settings()
    return {
        "enabled": settings.mcp_enabled,
        "endpoint_path": "/mcp",
        "transport": "streamable-http",
        "protocol_version": MCP_PROTOCOL_VERSION,
        "tools": mcp_tool_definitions(),
    }


async def execute_approval_in_new_session(
    request: Request, approval_id: int, admin: ApiKey, note: str | None
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        return await approve_approval_request(session, request, approval_id, admin, note)
