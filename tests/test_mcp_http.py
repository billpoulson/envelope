import os
import tempfile
import unittest
import asyncio
from pathlib import Path

from cryptography.fernet import Fernet

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "mcp-test-admin-key"
os.environ["ENVELOPE_MCP_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.auth_keys import hash_api_key, key_lookup_hmac  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import get_session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ApiKey  # noqa: E402


class McpHttpTests(unittest.TestCase):
    _token = "mcp-test-admin-key"

    async def _ensure_admin_key_async(self) -> None:
        factory = get_session_factory()
        async with factory() as session:
            lookup = key_lookup_hmac(self._token, get_settings().master_key)
            existing = await session.execute(select(ApiKey.id).where(ApiKey.key_lookup_hmac == lookup))
            if existing.scalar_one_or_none() is not None:
                return
            session.add(
                ApiKey(
                    name="mcp-test-admin",
                    key_hash=hash_api_key(self._token),
                    key_lookup_hmac=lookup,
                    scopes='["admin"]',
                )
            )
            await session.commit()

    def _ensure_admin_key(self) -> None:
        asyncio.run(self._ensure_admin_key_async())

    def _rpc(self, client: TestClient, method: str, params: dict | None = None) -> dict:
        r = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            headers={"Authorization": f"Bearer {self._token}"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_mcp_lists_tools_and_reads_projects(self) -> None:
        with TestClient(app) as client:
            self._ensure_admin_key()
            tools = self._rpc(client, "tools/list")["result"]["tools"]
            self.assertTrue(any(t["name"] == "list_projects" for t in tools))

            r = client.post(
                "/api/v1/projects",
                json={"name": "MCP Project", "slug": "mcp-project"},
                headers={"Authorization": f"Bearer {self._token}"},
            )
            self.assertEqual(r.status_code, 201, r.text)

            projects = self._rpc(
                client,
                "tools/call",
                {"name": "list_projects", "arguments": {}},
            )
            text = projects["result"]["content"][0]["text"]
            self.assertIn("mcp-project", text)

    def test_write_tool_creates_approval_and_admin_approval_executes(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            self._ensure_admin_key()
            pr = client.post(
                "/api/v1/projects",
                json={"name": "MCP Write Project", "slug": "mcp-write"},
                headers=h,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            er = client.post(
                "/api/v1/projects/mcp-write/environments",
                json={"name": "Default", "slug": "default"},
                headers=h,
            )
            self.assertEqual(er.status_code, 201, er.text)

            created = self._rpc(
                client,
                "tools/call",
                {
                    "name": "request_create_bundle",
                    "arguments": {
                        "name": "from-mcp",
                        "project_slug": "mcp-write",
                        "project_environment_slug": "default",
                        "entries": {"SECRET": {"value": "redacted-in-ui", "secret": True}},
                    },
                },
            )
            approval_id = created["result"]["structuredContent"]["id"]
            self.assertEqual(created["result"]["structuredContent"]["status"], "pending")

            listed = client.get("/api/v1/mcp/approvals?status=pending", headers=h)
            self.assertEqual(listed.status_code, 200, listed.text)
            args = listed.json()["approvals"][0]["arguments"]
            self.assertEqual(args["entries"], "[redacted]")

            approved = client.post(
                f"/api/v1/mcp/approvals/{approval_id}/approve",
                json={"note": "ok"},
                headers=h,
            )
            self.assertEqual(approved.status_code, 200, approved.text)
            self.assertEqual(approved.json()["status"], "executed")

            bundles = client.get(
                "/api/v1/bundles?project_slug=mcp-write&environment_slug=default",
                headers=h,
            )
            self.assertEqual(bundles.status_code, 200, bundles.text)
            self.assertIn("from-mcp", bundles.json())


if __name__ == "__main__":
    unittest.main()
