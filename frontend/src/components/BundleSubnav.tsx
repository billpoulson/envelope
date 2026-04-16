import { NavLink } from "react-router-dom";
import { projectBundlesBase } from "@/projectPaths";

type Props = {
  /** When omitted (legacy `/bundles/...` routes), links use `/bundles/:name/...`. */
  projectSlug?: string;
  /** Required with `projectSlug` for project-scoped routes (env-in-path). */
  environmentSlug?: string;
  bundleName: string;
  variant?: "default" | "embedded";
  /** Optional non-env query (e.g. `?key=foo`). */
  linkSearch?: string;
};

export function BundleSubnav({
  projectSlug,
  environmentSlug,
  bundleName,
  variant = "default",
  linkSearch = "",
}: Props) {
  const base =
    projectSlug && environmentSlug
      ? `${projectBundlesBase(projectSlug, environmentSlug)}/${encodeURIComponent(bundleName)}`
      : `/bundles/${encodeURIComponent(bundleName)}`;
  const qs = linkSearch || "";
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2 py-1 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`;
  const navCls =
    variant === "embedded"
      ? "flex flex-wrap gap-2"
      : "mb-6 flex flex-wrap gap-2 border-b border-border/60 pb-3";
  return (
    <nav className={navCls} aria-label="Bundle sections">
      <NavLink to={`${base}/edit${qs}`} end className={linkCls}>
        Variables
      </NavLink>
      <NavLink to={`${base}/env-links${qs}`} className={linkCls}>
        Env links
      </NavLink>
      <NavLink to={`${base}/sealed-secrets${qs}`} className={linkCls}>
        Sealed secrets
      </NavLink>
    </nav>
  );
}
