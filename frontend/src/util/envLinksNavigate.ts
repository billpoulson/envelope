import type { EnvLinkResolveResponse } from "@/api/envLinks";
import { ENV_LINK_HIGHLIGHT_SHA256_PARAM } from "@/envLinkHighlight";
import { projectBundlesBase, projectGatewayPath, projectStacksBase } from "@/projectPaths";

function appendHighlight(search: URLSearchParams, highlightSha256?: string): string {
  const h = highlightSha256?.trim().replace(/\s+/g, "").toLowerCase();
  if (h && /^[0-9a-f]{64}$/.test(h)) {
    search.set(ENV_LINK_HIGHLIGHT_SHA256_PARAM, h);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** React Router path + search for the Secret env URL page for a resolve response. */
export function envLinksPageLocation(
  res: EnvLinkResolveResponse,
  options?: { highlightSha256?: string },
): { pathname: string; search: string } {
  const enc = encodeURIComponent;
  const { resource, name, slug, project_slug, environment_slug } = res;
  const hl = options?.highlightSha256;
  const stackSeg = resource === "stack" ? (slug ?? name) : name;
  const bundleSeg = resource === "bundle" ? (slug ?? name) : name;

  if (project_slug) {
    if (environment_slug != null && String(environment_slug).trim() !== "") {
      const es = String(environment_slug).trim();
      const pathname =
        resource === "bundle"
          ? `${projectBundlesBase(project_slug, es)}/${enc(bundleSeg)}/env-links`
          : `${projectStacksBase(project_slug, es)}/${enc(stackSeg)}/env-links`;
      return { pathname, search: appendHighlight(new URLSearchParams(), hl) };
    }
    return { pathname: projectGatewayPath(project_slug), search: appendHighlight(new URLSearchParams(), hl) };
  }

  const pathname =
    resource === "bundle"
      ? `/bundles/${enc(bundleSeg)}/env-links`
      : `/stacks/${enc(stackSeg)}/env-links`;
  return { pathname, search: appendHighlight(new URLSearchParams(), hl) };
}
