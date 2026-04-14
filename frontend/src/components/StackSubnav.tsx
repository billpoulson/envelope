import { NavLink } from "react-router-dom";

type Props = {
  /** When omitted, links use `/stacks/:name/...` (ungrouped stacks). */
  projectSlug?: string;
  stackName: string;
};

export function StackSubnav({ projectSlug, stackName }: Props) {
  const base = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackName)}`
    : `/stacks/${encodeURIComponent(stackName)}`;
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2 py-1 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`;
  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-border/60 pb-3" aria-label="Stack sections">
      <NavLink to={`${base}/edit`} end className={linkCls}>
        Layers
      </NavLink>
      <NavLink to={`${base}/key-graph`} className={linkCls}>
        Key graph
      </NavLink>
      <NavLink to={`${base}/env-links`} className={linkCls}>
        Env links
      </NavLink>
    </nav>
  );
}
