# Jinja vs React: 1:1 parity matrix

**Goal:** The React admin at `/app` should offer the same capabilities as the Jinja/HTML UI (`app/web/routes.py` + `templates/`), after which Jinja admin routes can be deprecated behind a feature flag or removed.

**Current state:** Core CRUD, wizards, backup (raw + encrypted + restore), help (iframe), API keys create/revoke, certificates register/delete, sealed-secret wizard (paste ciphertext + recipients JSON), and `ENVELOPE_REACT_ADMIN_PRIMARY` redirects are implemented. Remaining work is mostly cleanup (drop unused Jinja templates after a release candidate) and polish.

Legend:

- **React** — UI exists under `frontend/src` (mounted at `/app` in production).
- **API** — `GET/POST/PATCH/DELETE /api/v1/...` sufficient for the SPA without HTML forms (session + CSRF where required).
- **Gap** — Still web-only, needs API exposure and/or React screens.

---

## Summary by area


| Area           | Jinja                                               | React today                               | API for parity                  |
| -------------- | --------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| Auth / session | `/login` HTML + POST                                | `/login` JSON                             | Yes (`/api/v1/auth/`*)          |
| Projects       | list, new, delete                                   | list, new, delete + deep links            | Yes                             |
| Bundles        | per-project wizard, edit, env links, sealed secrets | **Yes** (project + legacy paths)          | Yes                             |
| Stacks         | new, edit, key graph, env links                     | **Yes**                                   | Yes                             |
| API keys       | full CRUD                                           | list, **create (plaintext once), revoke** | Yes                             |
| Certificates   | full CRUD                                           | list, **create, delete**                  | Yes                             |
| Backup         | raw + encrypted + restore                           | **Yes**                                   | Yes                             |
| Help           | many HTML pages under `/help/`*                     | iframe picker → classic `/help/*`         | Content single-sourced in Jinja |
| Public         | `/env/{token}`                                      | N/A                                       | Keep server-rendered or static  |


---

## Bundle (detailed)


| Capability                          | Jinja        | React                      | API / notes                                                                       |
| ----------------------------------- | ------------ | -------------------------- | --------------------------------------------------------------------------------- |
| List bundles (global / per project) | Yes          | Yes                        | `GET /api/v1/bundles`, `?project_slug=`                                           |
| New bundle + initial import wizard  | Yes          | Yes                        | `POST` with `initial_paste` + `import_kind`; errors surfaced via `formatApiError` |
| Bundle edit: variables table        | Yes          | Yes                        | `GET`+`PATCH`, secret routes                                                      |
| Copy key names                      | Yes          | Yes                        | `GET …/key-names`                                                                 |
| Env links                           | Yes          | Yes                        | env-link endpoints                                                                |
| Sealed secrets                      | paste wizard | **4-step wizard** + delete | `POST /bundles/{name}/sealed-secrets`                                             |
| Bundle delete (typed confirm)       | Yes          | Yes                        | `DELETE`                                                                          |


---

## Stacks (detailed)


| Capability                  | Jinja | React | API / notes              |
| --------------------------- | ----- | ----- | ------------------------ |
| List stacks                 | Yes   | Yes   | `GET /api/v1/stacks`     |
| New stack                   | Yes   | Yes   | `POST /api/v1/stacks`    |
| Edit layers, rename, delete | Yes   | Yes   | `PATCH` / `DELETE`       |
| Key graph                   | Yes   | Yes   | `GET …/key-graph`        |
| Stack env links             | Yes   | Yes   | stack env-link endpoints |


---

## Routing / product

- `**BrowserRouter` basename:** `VITE_ADMIN_BASENAME` (e.g. `/app` in production builds).
- **Cutover:** `ENVELOPE_REACT_ADMIN_PRIMARY` redirects many Jinja admin GETs to `/app/...`; `/help/`* left for iframe embeds.
- **Deprecation:** Remove unused templates/handlers after a release candidate (optional follow-up).

---

## Suggested implementation order (engineering)

1. ~~Router shell~~
2. ~~Bundles / stacks~~
3. ~~Projects delete + links~~
4. ~~Backup encrypted + restore~~
5. ~~Help iframe~~
6. ~~API keys + certificates parity~~
7. **Cutover:** delete dead Jinja surface when ready.