import { ApiError } from "@/api/client";

/** Turn FastAPI `detail` (string, object, or validation array) into a readable message. */
export function formatApiDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return "Request failed";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && typeof item === "object" && "msg" in item) {
        const loc = "loc" in item && Array.isArray((item as { loc?: unknown }).loc)
          ? `${(item as { loc: unknown[] }).loc.join(".")}: `
          : "";
        return `${loc}${String((item as { msg: unknown }).msg)}`;
      }
      return JSON.stringify(item);
    });
    return parts.join("; ");
  }
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const o = detail as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
}

export function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    return formatApiDetail(e.detail);
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
