/** Append `name=value` to a path that may already contain a query string. */
export function appendQueryParam(path: string, name: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}
