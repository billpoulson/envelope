import type { ResourceScopeOpts } from "@/api/bundles";

/** Matches backend `UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL` — list filter for resources with no environment. */
export const UNASSIGNED_ENV_SLUG = "__unassigned__";

/**
 * Normalizes `env` from the location search string.
 * Malformed links sometimes use `?env=__unassigned__?key=foo` instead of `?env=__unassigned__&key=foo`,
 * which puts `__unassigned__?key=foo` in the `env` param — strip anything after the first `?`.
 */
export function envSearchParam(env: string | null | undefined): string | undefined {
  if (env == null) return undefined;
  let s = env.trim();
  if (!s) return undefined;
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q).trim();
  return s || undefined;
}

/**
 * Reads `key` from search params, or from a malformed `env` value that embedded `?key=...`
 * (see {@link envSearchParam}).
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

/** API query params to disambiguate duplicate bundle/stack names (use with project routes + `?env=`). */
export function resourceScopeFromNav(
  projectSlug: string | undefined,
  envFromSearch: string | null | undefined,
): ResourceScopeOpts | undefined {
  if (!projectSlug?.trim()) return undefined;
  const e = envSearchParam(envFromSearch);
  return { projectSlug: projectSlug.trim(), ...(e ? { environmentSlug: e } : {}) };
}

/** Resolve a bundle row for API calls from its environment slug (null → unassigned sentinel). */
export function bundleScopeForApi(
  projectSlug: string | undefined,
  bundleEnvironmentSlug: string | null | undefined,
): ResourceScopeOpts | undefined {
  if (!projectSlug?.trim()) return undefined;
  return {
    projectSlug: projectSlug.trim(),
    environmentSlug:
      bundleEnvironmentSlug != null && String(bundleEnvironmentSlug).trim() !== ""
        ? String(bundleEnvironmentSlug).trim()
        : UNASSIGNED_ENV_SLUG,
  };
}

/**
 * Slug to send as `project_environment_slug` when creating a bundle/stack from the SPA.
 * Undefined when the nav filter is “All” or “Unassigned” — creation must pick a concrete environment.
 */
export function environmentSlugForCreate(envFromUrl: string | null | undefined): string | undefined {
  const s = envSearchParam(envFromUrl);
  if (!s || s === UNASSIGNED_ENV_SLUG) return undefined;
  return s;
}

/** True when `environmentSlugForCreate` would return a concrete environment (create allowed). */
export function hasEnvironmentSlugForCreate(envFromUrl: string | null | undefined): boolean {
  return environmentSlugForCreate(envFromUrl) !== undefined;
}

/**
 * Query options for project bundle/stack list APIs when the nav environment filter is active.
 * - No `env` → no filter (show all in project).
 * - `__unassigned__` → only unassigned resources.
 * - Named env → only rows tagged with that environment (strict; excludes unassigned “shared” rows).
 */
export function environmentListApiOpts(envFromUrl: string | null | undefined): {
  environmentSlug?: string;
  includeUnassigned?: boolean;
} {
  const s = envSearchParam(envFromUrl);
  if (!s) return {};
  if (s === UNASSIGNED_ENV_SLUG) return { environmentSlug: s };
  return { environmentSlug: s, includeUnassigned: false };
}

/** Label for list-row chips from API `project_environment_*` fields. */
export function environmentChipLabel(row: {
  project_environment_slug: string | null;
  project_environment_name: string | null;
}): string {
  if (row.project_environment_slug == null) return "Unassigned";
  const n = row.project_environment_name?.trim();
  return n || row.project_environment_slug;
}
