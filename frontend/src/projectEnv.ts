import type { ResourceScopeOpts } from "@/api/bundles";

/**
 * Normalizes a path or query segment (legacy `?env=`).
 * Malformed links sometimes embed `?key=` inside the value — strip anything after the first `?`.
 */
export function envSegmentParam(env: string | null | undefined): string | undefined {
  if (env == null) return undefined;
  let s = env.trim();
  if (!s) return undefined;
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q).trim();
  return s || undefined;
}

/**
 * Reads `key` from search params, or from a malformed legacy `env` value that embedded `?key=...`.
 */
export function keyParamFromSearch(
  searchParams: URLSearchParams,
  rawEnv: string | null | undefined,
): string | null {
  const direct = searchParams.get("key");
  if (direct) return direct;
  const raw = rawEnv?.trim() ?? "";
  const idx = raw.indexOf("?key=");
  if (idx === -1) return null;
  const rest = raw.slice(idx + "?key=".length);
  const amp = rest.indexOf("&");
  const v = amp === -1 ? rest : rest.slice(0, amp);
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** @deprecated use {@link resourceScopeFromPath} from `@/projectPaths` */
export function resourceScopeFromNav(
  projectSlug: string | undefined,
  envFromSearch: string | null | undefined,
): ResourceScopeOpts | undefined {
  if (!projectSlug?.trim()) return undefined;
  const e = envSegmentParam(envFromSearch);
  return { projectSlug: projectSlug.trim(), ...(e ? { environmentSlug: e } : {}) };
}

/** Resolve bundle row scope for API — requires an environment slug. */
export function bundleScopeForApi(
  projectSlug: string | undefined,
  bundleEnvironmentSlug: string | null | undefined,
): ResourceScopeOpts | undefined {
  if (!projectSlug?.trim()) return undefined;
  if (bundleEnvironmentSlug == null || String(bundleEnvironmentSlug).trim() === "") return undefined;
  return {
    projectSlug: projectSlug.trim(),
    environmentSlug: String(bundleEnvironmentSlug).trim(),
  };
}

/** Slug for `project_environment_slug` when creating a bundle/stack (must be set in workspace routes). */
export function environmentSlugForCreate(envSlug: string | null | undefined): string | undefined {
  const s = envSegmentParam(envSlug);
  return s || undefined;
}

export function hasEnvironmentSlugForCreate(envSlug: string | null | undefined): boolean {
  return environmentSlugForCreate(envSlug) !== undefined;
}

/** List APIs for the current environment scope (strict; no unassigned rows). */
export function environmentListApiOpts(environmentSlug: string | undefined): {
  environmentSlug?: string;
  includeUnassigned?: boolean;
} {
  const s = envSegmentParam(environmentSlug);
  if (!s) return {};
  return { environmentSlug: s, includeUnassigned: false };
}
