/**
 * JSON API client. Uses session cookies + CSRF for browser calls (see /api/v1/auth/*).
 * Relative URLs work with Vite dev proxy (`/api` → FastAPI).
 */

const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const data = await parseJson(res);
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail ?? data;
    throw new ApiError(`HTTP ${res.status}`, res.status, detail);
  }
  return data as T;
}

export function getCsrfHeader(csrf: string): HeadersInit {
  return { "X-CSRF-Token": csrf };
}
