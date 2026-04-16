import { ApiError } from "@/api/client";
import { formatApiDetail } from "@/util/apiError";

/** Matches backend `scope_resolution.AMBIGUOUS_BUNDLE_SCOPE_CODE`. */
export const AMBIGUOUS_BUNDLE_SCOPE_CODE = "ambiguous_bundle_scope";

/** Matches backend `scope_resolution.AMBIGUOUS_STACK_SCOPE_CODE`. */
export const AMBIGUOUS_STACK_SCOPE_CODE = "ambiguous_stack_scope";

/** True when a project-scoped route is missing `:environmentSlug` (legacy bookmark). */
export function needsEnvironmentInUrl(environmentSlug: string | undefined): boolean {
  return !environmentSlug?.trim();
}

function apiErrorDetailObject(err: unknown): { code?: string; message?: string } | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const d = err.detail;
  if (d && typeof d === "object" && !Array.isArray(d) && "code" in d) {
    return d as { code?: string; message?: string };
  }
  return null;
}

export function isAmbiguousBundleScopeError(err: unknown): boolean {
  const o = apiErrorDetailObject(err);
  if (o?.code === AMBIGUOUS_BUNDLE_SCOPE_CODE) return true;
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  return formatApiDetail(err.detail).includes("Multiple bundles share this name");
}

export function isAmbiguousStackScopeError(err: unknown): boolean {
  const o = apiErrorDetailObject(err);
  if (o?.code === AMBIGUOUS_STACK_SCOPE_CODE) return true;
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  return formatApiDetail(err.detail).includes("Multiple stacks share this name");
}

/**
 * React Query `retry` callback: do not retry ambiguous scope errors (show picker immediately).
 * Other failures use up to 3 attempts (TanStack Query default).
 */
export function resourceScopeQueryRetry(failureCount: number, error: unknown): boolean {
  if (isAmbiguousBundleScopeError(error) || isAmbiguousStackScopeError(error)) return false;
  return failureCount < 3;
}
