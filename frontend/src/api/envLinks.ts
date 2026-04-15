import { apiFetch } from "./client";

export type EnvLinkResolveResponse = {
  resource: "bundle" | "stack";
  name: string;
  /** Present when the bundle/stack belongs to a project. */
  project_slug: string | null;
  /** With `project_slug`: environment slug, or `__unassigned__` when not assigned. */
  environment_slug: string | null;
};

/** Requires session or API key with write access to the owning bundle/stack (same as listing env links). */
export async function resolveEnvLinkByDigest(tokenSha256: string): Promise<EnvLinkResolveResponse> {
  const hex = tokenSha256.trim().replace(/\s+/g, "").toLowerCase();
  const q = new URLSearchParams({ token_sha256: hex });
  return apiFetch<EnvLinkResolveResponse>(`/env-links/resolve?${q.toString()}`, { method: "GET" });
}
