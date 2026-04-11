"""Integration tests for /tfstate (Terraform HTTP backend shape)."""

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

# Configure Envelope before importing the app (settings + DB path are read at import time).
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "tfstate-http-test-admin-key"
os.environ["ENVELOPE_PULUMI_STATE_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class TfstateHttpTests(unittest.TestCase):
    _token = "tfstate-http-test-admin-key"

    def _make_test_cert_pem(self, common_name: str) -> str:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = datetime.now(timezone.utc)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(private_key=key, algorithm=hashes.SHA256())
        )
        return cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")

    def test_get_404(self) -> None:
        with TestClient(app) as client:
            r = client.get(
                "/tfstate/blobs/test-stack/tfstate",
                headers={"Authorization": f"Bearer {self._token}"},
            )
        self.assertEqual(r.status_code, 404)

    def test_post_get_delete_round_trip(self) -> None:
        key = "demo/proj/stack.json"
        payload = b'{"version":3,"checkpoint":true}'
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            pr = client.post(f"/tfstate/blobs/{key}", content=payload, headers=h)
            self.assertEqual(pr.status_code, 200)
            gr = client.get(f"/tfstate/blobs/{key}", headers=h)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(gr.content, payload)
            dr = client.delete(f"/tfstate/blobs/{key}", headers=h)
        self.assertEqual(dr.status_code, 200)

    def test_lock_conflict(self) -> None:
        key = "lock-demo/state"
        h = {"Authorization": f"Bearer {self._token}"}
        a = '{"ID":"aaa","Operation":"OperationTypeApply"}'
        b = '{"ID":"bbb","Operation":"OperationTypeApply"}'
        with TestClient(app) as client:
            client.request("LOCK", f"/tfstate/blobs/{key}", content=a, headers=h)
            r2 = client.request("LOCK", f"/tfstate/blobs/{key}", content=b, headers=h)
            self.assertEqual(r2.status_code, 423)
            ul = client.request("UNLOCK", f"/tfstate/blobs/{key}", content=a, headers=h)
        self.assertEqual(ul.status_code, 200)

    def test_project_post_get_delete_round_trip(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        payload = b'{"version":4}'
        with TestClient(app) as client:
            cp = client.post("/api/v1/projects", json={"name": "TF Proj", "slug": "tfproj"}, headers=hj)
            self.assertEqual(cp.status_code, 201, cp.text)
            pr = client.post("/tfstate/projects/tfproj/default.tfstate", content=payload, headers=h)
            self.assertEqual(pr.status_code, 200)
            gr = client.get("/tfstate/projects/tfproj/default.tfstate", headers=h)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(gr.content, payload)
            dr = client.delete("/tfstate/projects/tfproj/default.tfstate", headers=h)
        self.assertEqual(dr.status_code, 200)

    def test_project_read_scope_cannot_write(self) -> None:
        h_admin = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            client.post("/api/v1/projects", json={"name": "RO Proj", "slug": "roproj"}, headers=h_admin)
            kr = client.post(
                "/api/v1/api-keys",
                json={"name": "ro-tf", "scopes": ["read:project:slug:roproj"]},
                headers=h_admin,
            )
            self.assertEqual(kr.status_code, 201, kr.text)
            ro_token = kr.json()["plain_key"]
        h_ro = {"Authorization": f"Bearer {ro_token}"}
        with TestClient(app) as client:
            pr = client.post("/tfstate/projects/roproj/s.tfstate", content=b"{}", headers=h_ro)
            self.assertEqual(pr.status_code, 403)

    def test_certificates_and_sealed_secret_flow(self) -> None:
        nonce = uuid4().hex[:8]
        project_slug = f"sealproj-{nonce}"
        bundle_name = f"sealed-demo-{nonce}"
        h_admin = {"Authorization": f"Bearer {self._token}"}
        h_admin_json = {**h_admin, "Content-Type": "application/json"}
        cert1_pem = self._make_test_cert_pem(f"user-one-{nonce}")
        cert2_pem = self._make_test_cert_pem(f"user-two-{nonce}")
        with TestClient(app) as client:
            cp = client.post(
                "/api/v1/projects",
                json={"name": f"Sealed Project {nonce}", "slug": project_slug},
                headers=h_admin_json,
            )
            self.assertEqual(cp.status_code, 201, cp.text)
            cb = client.post(
                "/api/v1/bundles",
                json={"name": bundle_name, "project_slug": project_slug},
                headers=h_admin_json,
            )
            self.assertEqual(cb.status_code, 201, cb.text)
            c1 = client.post(
                "/api/v1/certificates",
                json={"name": f"cert-one-{nonce}", "certificate_pem": cert1_pem},
                headers=h_admin_json,
            )
            self.assertEqual(c1.status_code, 201, c1.text)
            c2 = client.post(
                "/api/v1/certificates",
                json={"name": f"cert-two-{nonce}", "certificate_pem": cert2_pem},
                headers=h_admin_json,
            )
            self.assertEqual(c2.status_code, 201, c2.text)
            cert1_id = c1.json()["id"]
            cert2_id = c2.json()["id"]

            up = client.post(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                json={
                    "key_name": "APP_TOKEN",
                    "enc_alg": "aes-256-gcm",
                    "payload_ciphertext": "BASE64_CIPHERTEXT",
                    "payload_nonce": "BASE64_NONCE",
                    "payload_aad": "bundle-metadata",
                    "recipients": [
                        {
                            "certificate_id": cert1_id,
                            "wrapped_key": "WRAPPED_KEY_FOR_CERT1",
                            "key_wrap_alg": "rsa-oaep-256",
                        },
                        {
                            "certificate_id": cert2_id,
                            "wrapped_key": "WRAPPED_KEY_FOR_CERT2",
                            "key_wrap_alg": "rsa-oaep-256",
                        },
                    ],
                },
                headers=h_admin_json,
            )
            self.assertEqual(up.status_code, 204, up.text)

            lr = client.get(f"/api/v1/bundles/{bundle_name}/sealed-secrets", headers=h_admin)
            self.assertEqual(lr.status_code, 200, lr.text)
            rows = lr.json()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["key_name"], "APP_TOKEN")
            rec_ids = {r["certificate_id"] for r in rows[0]["recipients"]}
            self.assertEqual(rec_ids, {cert1_id, cert2_id})

            dr = client.delete(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                params={"key_name": "APP_TOKEN"},
                headers=h_admin,
            )
            self.assertEqual(dr.status_code, 200, dr.text)

            lr2 = client.get(f"/api/v1/bundles/{bundle_name}/sealed-secrets", headers=h_admin)
            self.assertEqual(lr2.status_code, 200, lr2.text)
            self.assertEqual(lr2.json(), [])

    def test_sealed_secret_rejects_unknown_certificate_id(self) -> None:
        nonce = uuid4().hex[:8]
        project_slug = f"sealmiss-{nonce}"
        bundle_name = f"sealed-miss-{nonce}"
        h_admin = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            cp = client.post(
                "/api/v1/projects",
                json={"name": f"Sealed Missing Cert {nonce}", "slug": project_slug},
                headers=h_admin,
            )
            self.assertEqual(cp.status_code, 201, cp.text)
            cb = client.post(
                "/api/v1/bundles",
                json={"name": bundle_name, "project_slug": project_slug},
                headers=h_admin,
            )
            self.assertEqual(cb.status_code, 201, cb.text)
            up = client.post(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                json={
                    "key_name": "API_TOKEN",
                    "enc_alg": "aes-256-gcm",
                    "payload_ciphertext": "X",
                    "payload_nonce": "Y",
                    "recipients": [
                        {
                            "certificate_id": 999999,
                            "wrapped_key": "WRAPPED",
                            "key_wrap_alg": "rsa-oaep-256",
                        }
                    ],
                },
                headers=h_admin,
            )
        self.assertEqual(up.status_code, 400)


if __name__ == "__main__":
    unittest.main()
