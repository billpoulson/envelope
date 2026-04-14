# End-to-end tests (planned)

Add **Playwright** or **Cypress** in CI to cover:

- Login → projects list → create project (session + CSRF).
- Bundles and stacks list pages against a test FastAPI instance.

The React app is served via Vite dev proxy or production `/app` mount.
