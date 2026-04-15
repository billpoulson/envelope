import { NavLink } from "react-router-dom";

type Props = {
  /** When omitted (legacy `/bundles/...` routes), links use `/bundles/:name/...`. */
  projectSlug?: string;
  bundleName: string;
  variant?: "default" | "embedded";
};

export function BundleSubnav({ projectSlug, bundleName, variant = "default" }: Props) {
  const base = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/bundles/${encodeURIComponent(bundleName)}`
    : `/bundles/${encodeURIComponent(bundleName)}`;
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2 py-1 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`;
  const navCls =
    variant === "embedded"
      ? "flex flex-wrap gap-2"
      : "mb-6 flex flex-wrap gap-2 border-b border-border/60 pb-3";
  return (
    <nav className={navCls} aria-label="Bundle sections">
      <NavLink to={`${base}/edit`} end className={linkCls}>
        Variables
      </NavLink>
      <NavLink to={`${base}/env-links`} className={linkCls}>
        Env links
      </NavLink>
      <NavLink to={`${base}/sealed-secrets`} className={linkCls}>
        Sealed secrets
      </NavLink>
    </nav>
  );
}
