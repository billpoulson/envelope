# React admin migration

Ordered checklist and ADRs live in the Cursor plan **React migration effort** (`react_migration_effort_4816aa37.plan.md`).

## In this folder


| Doc                                              | Purpose                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| **[PARITY.md](PARITY.md)**                       | **Jinja vs React 1:1 feature matrix and rollout order** |
| [web-api-inventory.md](web-api-inventory.md)     | Web routes vs `/api/v1` mapping (living)                |
| [api-gaps.md](api-gaps.md)                       | Remaining JSON/API work                                 |
| [adr/001-spa-auth.md](adr/001-spa-auth.md)       | Session + Bearer `get_api_key`                          |
| [adr/002-spa-hosting.md](adr/002-spa-hosting.md) | Vite build and deployment                               |


## Implemented in-repo

- `**/api/v1/auth/csrf`**, `**/auth/login**`, `**/auth/logout**`, `**/auth/session**` — JSON auth for the SPA (`app/api/v1/auth.py`).
- **Session-backed API access** — `get_api_key` accepts browser session `admin_key_id` after login (`app/deps.py`).
- `**frontend/`** — Vite + React + TypeScript + Tailwind + TanStack Query; dev server proxies `/api` to FastAPI.
- **Production** — if `frontend/dist/` exists, FastAPI mounts the SPA at `**/app`** (`app/main.py`).
- **React screens (first slice):** login, projects (list + create), bundles list, stacks list, API keys list, certificates list, raw DB backup download, help stub + link to classic `/help`.

**Not done yet (use classic UI):** bundle/stack editors, sealed secrets wizards, full backup/restore parity, removing Jinja routes. The full checklist and suggested build order are in **[PARITY.md](PARITY.md)**.

See the repository [README](../../README.md) for dev commands.