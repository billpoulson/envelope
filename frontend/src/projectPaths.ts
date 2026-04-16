import type { ResourceScopeOpts } from "@/api/bundles";

const enc = encodeURIComponent;

/** Gateway: choose environment before opening bundles/stacks. */
export function projectGatewayPath(projectSlug: string): string {
  return `/projects/${enc(projectSlug)}`;
}

export function projectBundlesBase(projectSlug: string, environmentSlug: string): string {
  return `/projects/${enc(projectSlug)}/env/${enc(environmentSlug)}/bundles`;
}

export function projectStacksBase(projectSlug: string, environmentSlug: string): string {
  return `/projects/${enc(projectSlug)}/env/${enc(environmentSlug)}/stacks`;
}

export function projectSettingsPath(projectSlug: string): string {
  return `/projects/${enc(projectSlug)}/settings`;
}

export function projectEnvironmentsPath(projectSlug: string): string {
  return `/projects/${enc(projectSlug)}/environments`;
}

/** Scope for bundle/stack API calls when using env-in-path project routes. */
export function resourceScopeFromPath(
  projectSlug: string | undefined,
  environmentSlug: string | undefined,
): ResourceScopeOpts | undefined {
  if (!projectSlug?.trim() || !environmentSlug?.trim()) return undefined;
  return {
    projectSlug: projectSlug.trim(),
    environmentSlug: environmentSlug.trim(),
  };
}

/** Removes `env` from search string; keeps `key` and other params. */
export function searchWithoutEnv(search: string): string {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  sp.delete("env");
  const s = sp.toString();
  return s ? `?${s}` : "";
}
