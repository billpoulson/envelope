# Security gaps (enterprise / hardening)

This document lists **known limitations** relative to typical **enterprise** or **high-assurance** expectations. It is not a penetration-test report or formal risk register. Deployment choices (reverse proxy, network isolation, IdP) can mitigate several items.

## What is already in good shape

- Fernet-backed encryption at rest (`ENVELOPE_MASTER_KEY`), required at startup.
- API keys stored as **bcrypt hashes**, not plaintext; resolution uses an **indexed lookup** (`key_lookup_hmac`) plus bcrypt verify for current keys (`app/deps.py`).
- OIDC admin login uses **state**, **nonce**, and **PKCE** (see `app/api/v1/auth.py`).
- **Rate limits** on sensitive routes (e.g. backup/restore, some exports, Terraform HTTP state).
- **CSRF** tokens for JSON auth flows and many mutating SPA calls (`X-CSRF-Token`).
- **Browser hardening headers** in-app (`app/security_headers.py`): baseline headers, optional default CSP (Swagger paths excluded), HSTS when `ENVELOPE_HTTPS_COOKIES=true`.
- SQLAlchemy ORM usage reduces raw-SQL injection risk.
- `.env` is gitignored; compose expects secrets via environment, not committed files.

## API key resolution (indexed lookup; residual legacy path)

**Current behavior:** Each API key row stores `key_lookup_hmac` (HMAC-SHA256 hex derived from `ENVELOPE_MASTER_KEY` and the raw key). `resolve_api_key` does one indexed `SELECT` then a **single** bcrypt verify (`app/deps.py`). New keys and bootstrap keys populate this column when the plaintext is known.

**Legacy:** Rows with `key_lookup_hmac IS NULL` (e.g. DB restored from before this column existed) still authenticate by scanning **only** those rows. Re-issue keys or rely on rotation to clear the legacy path.

**Operational note:** If `ENVELOPE_MASTER_KEY` is rotated, existing `key_lookup_hmac` values no longer match; those rows behave as legacy until keys are recreated with a known plaintext.

## Gap: SQLite-centric data plane

**Issue:** Default deployment uses **file-backed SQLite** (`ENVELOPE_DATABASE_URL`).

**Why it matters:** Many enterprises require **HA**, online backup primitives, replication, and separation of duties that managed RDBMS (or cloud DB) provides. SQLite is often acceptable only for **single-node** or **small team** deployments with agreed ops.

**Mitigation direction:** Run behind agreed RPO/RTO with file snapshots; or extend the product to support a server-grade database if required.

## Gap: Browser hardening headers not set in-app

**Status (partially addressed):** `[app/security_headers.py](../app/security_headers.py)` middleware (registered from `[app/main.py](../app/main.py)`) sets `**X-Content-Type-Options`**, `**X-Frame-Options: DENY`**, `**Referrer-Policy**`, `**Permissions-Policy**`, and a default `Content-Security-Policy` on routes outside Swagger/OpenAPI UI (`/docs`, `/redoc`, `/openapi.json`). `**Strict-Transport-Security**` is sent when `**ENVELOPE_HTTPS_COOKIES=true**` (same signal as secure session cookies). Disable all of this with `**ENVELOPE_SECURITY_HEADERS_ENABLED=false**`, or override CSP via `**ENVELOPE_SECURITY_CSP**` (`-` turns CSP off).

**Why it still matters:** TLS termination, CDN, and corporate gateways often own **stronger** or **complementary** policies (e.g. broader CSP, `includeSubDomains` on HSTS). Document proxy behavior for audits.

## Gap: CSRF coverage may be incomplete for cookie session auth

**Status (partially addressed):** For `/api/v1` routes that use `[get_api_key](../app/deps.py)`, mutating requests authenticated via **session cookie** (no `Authorization: Bearer`) must send a valid `**X-CSRF-Token`** matching the session; safe methods (`GET`, `HEAD`, `OPTIONS`) do not. Bearer-based clients are unchanged.

**Remaining vigilance:** New JSON routes must continue to depend on `get_api_key` (or otherwise enforce CSRF for cookie auth). Same-origin defaults and `SameSite` cookies are still not a substitute for reviewing new endpoints.

**Historical note:** The SPA auth ADR (`docs/react-migration/adr/001-spa-auth.md`) described extending CSRF as the app grew; enforcement is centralized in `get_api_key` for session-backed API calls.

## Gap: No built-in security audit trail

**Status (partially addressed):** The app emits **structured JSON audit lines** on logger `envelope.audit` and stores **append-only** rows in `audit_events` (see `app/services/audit.py`, `app/models.py` `AuditEvent`). Admin API: `GET /api/v1/system/audit-events`. Flags: `ENVELOPE_AUDIT_LOG_ENABLED`, `ENVELOPE_AUDIT_DATABASE_ENABLED` (see main `README.md`). **Operator guide:** [docs/audit-trail.md](audit-trail.md); in-app **Help** → **Security audit trail** (`/help/audit`).

**Residual expectations:** True immutability, long-term retention, and authoritative client IP for compliance are still typically owned by **SIEM/log pipelines**, **database access controls**, and/or **reverse-proxy access logs**. Opaque `/env/{token}` downloads have no API key identity in-app; correlate via `token_sha256` prefix in audit rows and gateway logs.

**Mitigation direction:** Continue to log at the proxy/WAF for defense in depth; ship `envelope.audit` JSON to your aggregator; tune retention in your log/DB stack.

## Gap: IAM model is API-key–centric

**Issue:** Automation uses **long-lived API keys**. The admin UI can use **OIDC**, but the product is not a full **enterprise IdP** (SCIM, group-driven RBAC, centralized session revocation across all clients, device posture, etc.).

**Why it matters:** Enterprise IAM teams may expect SSO-first automation, short-lived tokens, or directory-synced roles.

**Mitigation direction:** Use OIDC for humans; restrict and rotate API keys; network policies for CI runners; document key lifecycle.

## Supply-chain / CI security checks

**Status (addressed in default CI):** [`.github/workflows/ci-ghcr.yml`](../.github/workflows/ci-ghcr.yml) runs **`pip-audit`** on [`requirements.txt`](../requirements.txt), **`npm audit --audit-level=high`** after `npm ci` in [`frontend/`](../frontend/), **Bandit** (`-ll`, config [`bandit.yaml`](../bandit.yaml)) on `app/` and `cli/`, and **Trivy** on the built image (CRITICAL/HIGH, non-zero exit on matches). These steps are **blocking** for merges that use this workflow as a required check.

**Residual:** Tune severities (`npm audit` level, Trivy `severity` / `ignore-unfixed`) if your org wants stricter or advisory-only runs; optional SARIF upload to GitHub Advanced Security is not wired here.

## Gap: Rate limiting is partial

**Issue:** `slowapi` cannot cover every route with equally tight caps without breaking automation (exports, Terraform state, CI). Some handlers remain intentionally less restricted.

**Why it matters:** Abuse and accidental hot loops can still stress less-limited routes.

**Mitigation direction:** App limits now cover JSON login, OIDC flows, API key and certificate CRUD, and sealed-secret endpoints, in addition to exports/backups/tfstate/system (see `app/limiter.py`). Add **gateway-level** rate zones for coarse caps; tune per deployment (see main `README.md`, “Behind a gateway” → “Edge rate limits”).

---

## Using this project in an enterprise

Reasonable patterns:

- Deploy **only** on trusted networks or with **mTLS**/VPN; expose minimally.
- Terminate **HTTPS** at a gateway; set `ENVELOPE_HTTPS_COOKIES=true` and correct `FORWARDED_ALLOW_IPS` (see main `README.md`).
- **Disable** optional footguns in production (e.g. keep `ENVELOPE_RESTORE_ENABLED` off unless needed).
- **Rotate** API keys and `ENVELOPE_INITIAL_ADMIN_KEY` bootstrap discipline.
- Treat this document as a **checklist** for security review with your own risk owner.

