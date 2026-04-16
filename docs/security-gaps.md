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

**Status (partially addressed):** `[app/security_headers.py](../app/security_headers.py)` middleware (registered from `[app/main.py](../app/main.py)`) sets `**X-Content-Type-Options`**, `**X-Frame-Options: DENY**`, `**Referrer-Policy**`, `**Permissions-Policy**`, and a **default `Content-Security-Policy`** on routes **outside** Swagger/OpenAPI UI (`/docs`, `/redoc`, `/openapi.json`). `**Strict-Transport-Security`** is sent when `**ENVELOPE_HTTPS_COOKIES=true**` (same signal as secure session cookies). Disable all of this with `**ENVELOPE_SECURITY_HEADERS_ENABLED=false**`, or override CSP via `**ENVELOPE_SECURITY_CSP**` (`-` turns CSP off).

**Why it still matters:** TLS termination, CDN, and corporate gateways often own **stronger** or **complementary** policies (e.g. broader CSP, `includeSubDomains` on HSTS). Document proxy behavior for audits.

## Gap: CSRF coverage may be incomplete for cookie session auth

**Status (partially addressed):** For `/api/v1` routes that use `[get_api_key](../app/deps.py)`, mutating requests authenticated via **session cookie** (no `Authorization: Bearer`) must send a valid `**X-CSRF-Token`** matching the session; safe methods (`GET`, `HEAD`, `OPTIONS`) do not. Bearer-based clients are unchanged.

**Remaining vigilance:** New JSON routes must continue to depend on `get_api_key` (or otherwise enforce CSRF for cookie auth). Same-origin defaults and `SameSite` cookies are still not a substitute for reviewing new endpoints.

**Historical note:** The SPA auth ADR (`docs/react-migration/adr/001-spa-auth.md`) described extending CSRF as the app grew; enforcement is centralized in `get_api_key` for session-backed API calls.

## Gap: No built-in security audit trail

**Issue:** There is no first-class **append-only audit log** (e.g. who exported which bundle, from which identity, at what time) for compliance workflows.

**Why it matters:** SOC2, ISO 27001, and internal security teams often require queryable access logs and retention policies.

**Mitigation direction:** Log at the proxy/WAF; or add structured application audit events to your log pipeline.

## Gap: IAM model is API-key–centric

**Issue:** Automation uses **long-lived API keys**. The admin UI can use **OIDC**, but the product is not a full **enterprise IdP** (SCIM, group-driven RBAC, centralized session revocation across all clients, device posture, etc.).

**Why it matters:** Enterprise IAM teams may expect SSO-first automation, short-lived tokens, or directory-synced roles.

**Mitigation direction:** Use OIDC for humans; restrict and rotate API keys; network policies for CI runners; document key lifecycle.

## Gap: Supply-chain / CI security checks

**Issue:** CI runs tests and builds containers (`.github/workflows/ci-ghcr.yml`) but does not show **dependency scanning** (e.g. `pip-audit`, `npm audit`), container image scanning, or SAST as part of the default pipeline.

**Why it matters:** Enterprise SDLC policies often require automated vulnerability signals on every change.

**Mitigation direction:** Add optional or required jobs for dependency and image scanning; track advisories for pinned versions in `requirements.txt` and `frontend/package.json`.

## Gap: Rate limiting is partial

**Issue:** `slowapi` limits apply to **some** routes (backup, certain exports, login, tfstate, etc.), not necessarily every expensive or sensitive endpoint.

**Why it matters:** Abuse and accidental hot loops can still stress unbounded routes.

**Mitigation direction:** Review high-cost handlers; add limits or lower caps at the gateway.

---

## Using this project in an enterprise

Reasonable patterns:

- Deploy **only** on trusted networks or with **mTLS**/VPN; expose minimally.
- Terminate **HTTPS** at a gateway; set `ENVELOPE_HTTPS_COOKIES=true` and correct `FORWARDED_ALLOW_IPS` (see main `README.md`).
- **Disable** optional footguns in production (e.g. keep `ENVELOPE_RESTORE_ENABLED` off unless needed).
- **Rotate** API keys and `ENVELOPE_INITIAL_ADMIN_KEY` bootstrap discipline.
- Treat this document as a **checklist** for security review with your own risk owner.

