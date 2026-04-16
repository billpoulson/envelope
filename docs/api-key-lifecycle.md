# API keys, OIDC, and IAM expectations

Envelope separates **human** access to the admin UI from **automation** (CI, scripts, Terraform) that calls the HTTP API. This page is for security and IAM reviewers who need to know what the product provides and what remains an operator responsibility.

## Human administrators (browser)

- Configure **OpenID Connect (OIDC)** so operators sign in with your corporate IdP instead of pasting an API key into the browser. OIDC settings can come from environment variables (`ENVELOPE_OIDC_*`) or from in-app settings when the database holds OIDC configuration; see the main [README.md](../README.md) and in-app **Help**.
- The interactive flow uses standard OAuth2/OIDC patterns (including PKCE). Envelope is **not** a replacement for your IdP: it consumes OIDC for login only.

## Automation (API keys)

- Integrations use `Authorization: Bearer <api-key>`. Keys are stored as **bcrypt hashes** in the database; the plaintext is shown **once** at creation.
- Apply the **minimum scopes** required (for example project-scoped read/write for Terraform remote state under `/tfstate/projects/…`, or narrow bundle/stack scopes). Prefer **one key per pipeline or service** so compromise or rotation affects a single integration.
- **Optional expiration:** When creating a key (API or web UI), you may set an **expiry time** (UTC). After that time, the key returns `401` until you create a new key and revoke the old one. Omitting expiry means the key remains valid until revoked (still a long-lived secret—plan rotation accordingly).

## Rotation and revocation

1. Create a new key with the same or tighter scopes (optionally with an expiration for time-bounded CI).
2. Update your secret store, CI variables, or runtime config to use the new plaintext.
3. **Revoke** the old key in **API keys** in the UI or via `DELETE /api/v1/api-keys/{id}`.

For the very first deployment, `ENVELOPE_INITIAL_ADMIN_KEY` bootstraps the first admin key. **Remove it from the environment** after you have created another admin key and stored it safely (see the README).

## Network and CI posture

Envelope does **not** enforce device posture or IP allowlists by itself. Typical enterprise controls:

- Run CI on **private runners** or **egress-restricted** networks that can reach Envelope only from approved paths.
- Use your **reverse proxy or cloud firewall** for mTLS, IP allowlists, or WAF rules in front of the app.
- Keep the Envelope URL off the public internet if policy requires internal-only access.

## What Envelope does not provide (by design)

Align expectations with [security-gaps.md](security-gaps.md):

- **No SCIM** or automatic directory provisioning into Envelope.
- **No group-to-role sync** from your IdP into API key scopes; scopes are defined in Envelope when the key is created.
- **No centralized “logout everywhere”** for API keys: revocation is **per key** (delete/revoke). Browser OIDC sessions are separate from API key credentials.
- **No SSO/OIDC for machine clients** in place of API keys: automation is API-key–based unless you wrap it in your own broker.

For deployment hardening (TLS, headers, audit logging), see the README and [audit-trail.md](audit-trail.md).
