# API gaps (living document)

Use this during Phase 3 to track web-only operations that need JSON endpoints.

- **Auth:** addressed by `/api/v1/auth/*` and session-aware `get_api_key` ([`app/deps.py`](../../app/deps.py)) — existing `/api/v1` routes work from the React admin after JSON login without `Authorization: Bearer` for that session.
- **Key graph:** web exposes `GET .../key-graph/data`; confirm or add `GET /api/v1/stacks/{name}/key-graph` if missing.
- **Variable key names:** currently under web path `/projects/.../variable-key-names`; consider `GET /api/v1/bundles/{name}/variable-key-names?project_slug=` for SPA.
- **Import / backup edge cases:** compare [`app/web/routes.py`](../../app/web/routes.py) POST handlers with [`app/api/v1/bundles.py`](../../app/api/v1/bundles.py) and [`system.py`](../../app/api/v1/system.py).

Close items as they are implemented and tested.
