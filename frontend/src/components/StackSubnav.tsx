import { NavLink } from "react-router-dom";

type Props = {
  /** When omitted, links use `/stacks/:name/...` (ungrouped stacks). */
  projectSlug?: string;
  stackName: string;
  /** Tighter layout for full-page key graph (no bottom margin; border optional). */
  variant?: "default" | "embedded";
  linkSearch?: string;
};

export function StackSubnav({
  projectSlug,
  stackName,
  variant = "default",
  linkSearch = "",
}: Props) {
  const base = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackName)}`
    : `/stacks/${encodeURIComponent(stackName)}`;
  const qs = linkSearch || "";
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2 py-1 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`;
  const navCls =
    variant === "embedded"
      ? "flex flex-wrap gap-2"
      : "mb-6 flex flex-wrap gap-2 border-b border-border/60 pb-3";
  return (
    <nav className={navCls} aria-label="Stack sections">
      <NavLink to={`${base}/edit${qs}`} end className={linkCls}>
        Layers
      </NavLink>
      <NavLink to={`${base}/key-graph${qs}`} className={linkCls}>
        Key graph
      </NavLink>
      <NavLink to={`${base}/env-links${qs}`} className={linkCls}>
        Env links
      </NavLink>
    </nav>
  );
}
