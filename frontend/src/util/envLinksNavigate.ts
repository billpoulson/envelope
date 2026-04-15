import type { EnvLinkResolveResponse } from "@/api/envLinks";

/** React Router path + search for the Secret env URL page for a resolve response. */
export function envLinksPageLocation(res: EnvLinkResolveResponse): { pathname: string; search: string } {
  const enc = encodeURIComponent;
  const { resource, name, project_slug, environment_slug } = res;

  if (project_slug) {
    const pathname =
      resource === "bundle"
        ? `/projects/${enc(project_slug)}/bundles/${enc(name)}/env-links`
        : `/projects/${enc(project_slug)}/stacks/${enc(name)}/env-links`;
    const search =
      environment_slug != null && environment_slug !== ""
        ? `?env=${encodeURIComponent(environment_slug)}`
        : "";
    return { pathname, search };
  }

  const pathname =
    resource === "bundle" ? `/bundles/${enc(name)}/env-links` : `/stacks/${enc(name)}/env-links`;
  return { pathname, search: "" };
}
