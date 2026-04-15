import type { EnvLinkResolveResponse } from "@/api/envLinks";
import { ENV_LINK_HIGHLIGHT_SHA256_PARAM } from "@/envLinkHighlight";

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
    const pathname =
      resource === "bundle"
        ? `/projects/${enc(project_slug)}/bundles/${enc(bundleSeg)}/env-links`
        : `/projects/${enc(project_slug)}/stacks/${enc(stackSeg)}/env-links`;
    const p = new URLSearchParams();
    if (environment_slug != null && environment_slug !== "") {
      p.set("env", environment_slug);
    }
    return { pathname, search: appendHighlight(p, hl) };
  }

  const pathname =
    resource === "bundle"
      ? `/bundles/${enc(bundleSeg)}/env-links`
      : `/stacks/${enc(stackSeg)}/env-links`;
  return { pathname, search: appendHighlight(new URLSearchParams(), hl) };
}
