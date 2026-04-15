/**
 * Public base URL of this Envelope deployment: origin + optional gateway path
 * segment before `/app/…` (matches how `/cli/…` and `/api/…` are exposed).
 */
export function getDeploymentBaseUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const { origin, pathname } = window.location;
  let i = pathname.indexOf("/app/");
  if (i < 0) {
    const j = pathname.lastIndexOf("/app");
    if (j >= 0 && j === pathname.length - 4) {
      i = j;
    } else {
      return origin;
    }
  }
  if (i <= 0) {
    return origin;
  }
  const prefix = pathname.slice(0, i).replace(/\/$/, "");
  return prefix ? `${origin}${prefix}` : origin;
}
