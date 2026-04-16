import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { envSegmentParam } from "@/projectEnv";
import { projectGatewayPath, searchWithoutEnv } from "@/projectPaths";

type Kind = "bundles" | "stacks";

const RESERVED_ENV_LIKE = new Set(["settings", "environments", "env", "new"]);

/**
 * Redirects pre–env-in-path URLs:
 * `/projects/:projectSlug/{bundles,stacks}/*` + optional `?env=` → env-scoped path or gateway.
 */
export function LegacyProjectWorkspaceRedirect({ kind }: { kind: Kind }) {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const env = envSegmentParam(searchParams.get("env"));
  const ps = encodeURIComponent(projectSlug);
  const prefix = `/projects/${ps}/${kind}`;

  let tail = "";
  if (location.pathname.startsWith(prefix)) {
    tail = location.pathname.slice(prefix.length);
  }
  if (tail === "") tail = "/";

  const search = searchWithoutEnv(location.search);

  if (!env) {
    return <Navigate to={`${projectGatewayPath(projectSlug)}${search}`} replace />;
  }

  const e = encodeURIComponent(env);
  const path =
    tail === "/"
      ? `/projects/${ps}/env/${e}/${kind}`
      : `/projects/${ps}/env/${e}/${kind}${tail.startsWith("/") ? tail : `/${tail}`}`;

  return <Navigate to={`${path}${search}`} replace />;
}

/**
 * Redirects bookmarks without the literal `env` segment:
 * `/projects/:projectSlug/:legacyEnv/{bundles,stacks}/*` → `/projects/.../env/:legacyEnv/...`
 */
export function LegacyOldEnvSegmentRedirect({ kind }: { kind: Kind }) {
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";
  const legacyEnv = params.legacyEnv ?? "";
  const splat = params["*"] ?? "";
  const location = useLocation();

  const search = searchWithoutEnv(location.search);

  if (!projectSlug || !legacyEnv || RESERVED_ENV_LIKE.has(legacyEnv)) {
    return <Navigate to={`${projectGatewayPath(projectSlug)}${search}`} replace />;
  }

  const ps = encodeURIComponent(projectSlug);
  const le = encodeURIComponent(legacyEnv);
  const oldBase = `/projects/${ps}/${le}/${kind}`;
  if (!location.pathname.startsWith(oldBase)) {
    return <Navigate to={`${projectGatewayPath(projectSlug)}${search}`} replace />;
  }

  const tail = splat ? `/${splat}` : "";
  const path = `/projects/${ps}/env/${le}/${kind}${tail}`;

  return <Navigate to={`${path}${search}`} replace />;
}
