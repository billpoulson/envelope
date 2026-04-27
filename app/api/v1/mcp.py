from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_admin
from app.models import ApiKey
from app.services.mcp import (
    approve_approval_request,
    deny_approval_request,
    get_approval_request,
    list_approval_requests,
    mcp_status_payload,
)

router = APIRouter(prefix="/mcp")


class McpDecisionBody(BaseModel):
    note: str | None = Field(None, max_length=4000)


@router.get("/status")
async def get_mcp_status(_: ApiKey = Depends(require_admin)) -> dict[str, Any]:
    return mcp_status_payload()


@router.get("/approvals")
async def list_mcp_approvals(
    status: Literal["pending", "denied", "executed", "failed"] | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return {"approvals": await list_approval_requests(session, status=status, limit=limit)}


@router.get("/approvals/{approval_id}")
async def get_mcp_approval(
    approval_id: int,
    _: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await get_approval_request(session, approval_id)


@router.post("/approvals/{approval_id}/approve")
async def approve_mcp_approval(
    approval_id: int,
    body: McpDecisionBody,
    request: Request,
    admin: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await approve_approval_request(session, request, approval_id, admin, body.note)


@router.post("/approvals/{approval_id}/deny")
async def deny_mcp_approval(
    approval_id: int,
    body: McpDecisionBody,
    request: Request,
    admin: ApiKey = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await deny_approval_request(session, request, approval_id, admin, body.note)
