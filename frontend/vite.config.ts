import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Must match `VITE_ADMIN_BASENAME` / FastAPI mount (`/app`). Using `./` breaks deep routes:
 * the browser resolves `./assets/…` relative to the current URL path, so `/app/projects/…/edit`
 * loads `/app/projects/…/assets/…` (404 → white page on reload).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const adminBasename = (env.VITE_ADMIN_BASENAME ?? "").trim().replace(/\/$/, "");
  const base = adminBasename ? `${adminBasename}/` : "/";

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
