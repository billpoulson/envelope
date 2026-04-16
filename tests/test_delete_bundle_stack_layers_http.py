"""Deleting a bundle must drop its stack layer rows so GET /stacks/{name} still works (SQLite FK quirks)."""

import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "delete-bundle-stack-layers-test-key"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _ensure_default_environment(client: TestClient, hj: dict[str, str], project_slug: str) -> None:
    r = client.post(
        f"/api/v1/projects/{project_slug}/environments",
        json={"name": "Default", "slug": "default"},
        headers=hj,
    )
    assert r.status_code == 201, r.text


class DeleteBundleRemovesStackLayersHttpTests(unittest.TestCase):
    _token = "delete-bundle-stack-layers-test-key"

    def test_delete_bundle_removes_layer_stack_still_readable(self) -> None:
        nonce = uuid4().hex[:8]
        project_slug = f"delstk-{nonce}"
        b1 = f"bundle-a-{nonce}"
        b2 = f"bundle-b-{nonce}"
        stack_name = f"twolayer-{nonce}"
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"Del stack {nonce}", "slug": project_slug},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, project_slug)
            for bn in (b1, b2):
                br = client.post(
                    "/api/v1/bundles",
                    json={
                        "name": bn,
                        "project_slug": project_slug,
                        "project_environment_slug": "default",
                    },
                    headers=hj,
                )
                self.assertEqual(br.status_code, 201, br.text)
            sr = client.post(
                "/api/v1/stacks",
                json={
                    "name": stack_name,
                    "project_slug": project_slug,
                    "project_environment_slug": "default",
                    "layers": [{"bundle": b1, "keys": "*"}, {"bundle": b2, "keys": "*"}],
                },
                headers=hj,
            )
            self.assertEqual(sr.status_code, 201, sr.text)

            dr = client.delete(
                f"/api/v1/bundles/{b1}",
                params={"project_slug": project_slug, "environment_slug": "default"},
                headers=h,
            )
            self.assertEqual(dr.status_code, 204, dr.text)

            gr = client.get(
                f"/api/v1/stacks/{stack_name}",
                params={"project_slug": project_slug, "environment_slug": "default"},
                headers=h,
            )
            self.assertEqual(gr.status_code, 200, gr.text)
            body = gr.json()
            layers = body.get("layers") or []
            self.assertEqual(len(layers), 1)
            self.assertEqual(layers[0].get("bundle"), b2)


if __name__ == "__main__":
    unittest.main()
