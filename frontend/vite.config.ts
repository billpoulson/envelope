import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const COUNTER_FILE = fileURLToPath(new URL(".vite-daily-build.json", import.meta.url));

function utcDateKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/** Per-UTC-day counter on disk so repeated `vite build` runs bump …N on the same day. */
function dailyBuildSegment(increment: boolean): string {
  const now = new Date();
  const dateKey = utcDateKey(now);
  let n: number;

  try {
    const raw = readFileSync(COUNTER_FILE, "utf8");
    const data = JSON.parse(raw) as { date?: string; n?: number };
    if (data.date === dateKey && typeof data.n === "number" && data.n >= 1) {
      n = increment ? data.n + 1 : data.n;
    } else if (increment) {
      n = 1;
    } else {
      return "0";
    }
  } catch {
    if (increment) {
      n = 1;
    } else {
      return "0";
    }
  }

  if (increment) {
    try {
      writeFileSync(COUNTER_FILE, `${JSON.stringify({ date: dateKey, n }, null, 2)}\n`, "utf8");
    } catch {
      return String(Date.now());
    }
  }
  return String(n);
}

function appBuildVersion(command: "build" | "serve"): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const fromEnv =
    process.env.VITE_BUILD_NUMBER?.trim() ||
    process.env.BUILD_NUMBER?.trim() ||
    process.env.GITHUB_RUN_NUMBER?.trim() ||
    process.env.CI_PIPELINE_IID?.trim() ||
    "";
  const build =
    fromEnv || dailyBuildSegment(command === "build");
  return `${y}.${m}.${d}.${build}`;
}

/**
 * Must match `VITE_ADMIN_BASENAME` / FastAPI mount (`/app`). Using `./` breaks deep routes:
 * the browser resolves `./assets/…` relative to the current URL path, so `/app/projects/…/edit`
 * loads `/app/projects/…/assets/…` (404 → white page on reload).
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const adminBasename = (env.VITE_ADMIN_BASENAME ?? "").trim().replace(/\/$/, "");
  const base = adminBasename ? `${adminBasename}/` : "/";

  return {
    base,
    define: {
      "import.meta.env.VITE_APP_BUILD_VERSION": JSON.stringify(appBuildVersion(command)),
    },
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
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
