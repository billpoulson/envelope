# Envelope — usage guide

The **canonical** text for the web UI Help screen lives in `**[frontend/src/help/usage.md](../frontend/src/help/usage.md)`**. Edit that file to change in-app help (`/help`, `/help/web-ui`, …); it is bundled by Vite and included in Docker builds (only the `frontend/` tree is copied into the image frontend stage).

In the running app, open **Help** → **Installation & hosting** for Docker, env vars, TLS, and reverse proxies. The interactive API reference is at `**/docs`**.

**Database (SQLite or PostgreSQL):** see **[database-configuration.md](database-configuration.md)** for `ENVELOPE_DATABASE_URL`, Docker Compose with PostgreSQL, TLS, backups, and migration notes.

**On GitHub:** open `[frontend/src/help/usage.md](../frontend/src/help/usage.md)` for the bundled guide (overview, installation, Web UI, API export, sealed secrets, Terraform state, backups, security).