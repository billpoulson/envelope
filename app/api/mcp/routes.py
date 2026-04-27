from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel

from app.db import get_session_factory
from app.deps import record_api_key_last_access, resolve_api_key
from app.services.mcp import MCP_PROTOCOL_VERSION, call_mcp_tool, mcp_tool_definitions

router = APIRouter()


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


def _result(request_id: int | str | None, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: int | str | None, code: int, message: str, data: Any = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    if data is not None:
        payload["error"]["data"] = data
    return payload


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing API key")
    return token


@router.get("")
async def mcp_get() -> dict[str, Any]:
    """Small discovery response; JSON-RPC messages are sent with POST."""
    return {
        "name": "Envelope MCP",
        "transport": "streamable-http",
        "endpoint": "/mcp",
        "protocol_version": MCP_PROTOCOL_VERSION,
    }


@router.post("", response_model=None)
async def mcp_post(
    rpc: JsonRpcRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> Any:
    request_id = rpc.id
    if rpc.jsonrpc != "2.0":
        return _error(request_id, -32600, "Invalid JSON-RPC version")

    if rpc.method == "initialize":
        return _result(
            request_id,
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Envelope", "version": "1.0.0"},
            },
        )
    if rpc.method == "notifications/initialized":
        return Response(status_code=202)
    if rpc.method == "ping":
        return _result(request_id, {})

    token = _bearer_token(authorization)
    factory = get_session_factory()
    async with factory() as session:
        key = await resolve_api_key(token, session)
        await record_api_key_last_access(key, request, session)
        if rpc.method == "tools/list":
            return _result(request_id, {"tools": mcp_tool_definitions()})
        if rpc.method == "tools/call":
            params = rpc.params or {}
            name = str(params.get("name") or "")
            arguments = params.get("arguments")
            if not name:
                return _error(request_id, -32602, "Missing tool name")
            if arguments is not None and not isinstance(arguments, dict):
                return _error(request_id, -32602, "Tool arguments must be an object")
            try:
                value = await call_mcp_tool(session, request, key, name, arguments or {})
            except HTTPException as exc:
                return _error(request_id, -32000, str(exc.detail), {"status": exc.status_code})
            text = value if isinstance(value, str) else value
            return _result(
                request_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": text if isinstance(text, str) else json.dumps(text, default=str, indent=2),
                        }
                    ],
                    "structuredContent": value,
                    "isError": False,
                },
            )
    return _error(request_id, -32601, f"Unsupported method: {rpc.method}")
