# ADR 002: Building and hosting the React admin

## Context

- FastAPI serves [`static/`](../../static/) at `/static` and Jinja templates for HTML.
- Deployments may use [`ENVELOPE_ROOT_PATH`](../../app/config.py) behind a reverse proxy.

## Decision

1. **Vite** builds the SPA into `frontend/dist/` (committed only as build output in CI, or copied into `static/app/` during release).
2. **Development:** `npm run dev` (Vite) proxies `/api` to the local FastAPI origin (e.g. `localhost:8000`).
3. **Production:** Either serve `index.html` + hashed assets from `static/app/` with a catch-all route for client-side routes under the admin prefix, or host the SPA on a separate origin with CORS + credentials (second phase if needed).
4. **Tailwind** is compiled into the Vite bundle; the legacy [`static/style.css`](../../static/style.css) is not required for the SPA.

## Consequences

- CI should run `npm ci && npm run build` before Docker image build if the image embeds the SPA.
- Cache busting: Vite file hashes replace the current CSS fingerprint in [`app/main.py`](../../app/main.py) for HTML only; SPA uses its own asset names.

## Status

Accepted for migration Phase 1 / 10.
