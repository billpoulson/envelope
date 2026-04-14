# ADR 001: SPA authentication for the React admin

## Context

- Today the browser UI uses **Starlette sessions** (`session["admin"]`) after validating an **admin API key** via HTML POST [`/login`](../../app/web/routes.py).
- The JSON API uses **`Authorization: Bearer <api_key>`** via [`get_api_key`](../../app/deps.py).
- The React app should call `/api/v1` with **cookie sessions** for interactive admins without pasting a key on every request.

## Decision

1. On successful login (HTML or JSON), store **`admin_key_id`** (database id of the verified `ApiKey` row) in the session alongside `admin=True`.
2. Extend **`get_api_key`** to accept **either** a Bearer token **or** a session with valid `admin_key_id` pointing at an admin-scoped key.
3. Add JSON endpoints: **`GET /api/v1/auth/csrf`**, **`POST /api/v1/auth/login`**, **`POST /api/v1/auth/logout`**, **`GET /api/v1/auth/session`** using the same CSRF session keys as the web (`csrf` in session).
4. **Automation and CI** continue to use **Bearer only**; behavior is unchanged when `Authorization` is present.

## Consequences

- Positive: Single dependency (`get_api_key`) for API routes; SPA and CLI share `/api/v1`.
- Risk: Session fixation / CSRF — mutating requests from the browser must send **`X-CSRF-Token`** (validated on auth routes; extend to other POST/PUT/DELETE as the SPA grows).
- Logout and key revocation: session cleared; `admin_key_id` removed.

## Status

Accepted for migration Phase 2.
