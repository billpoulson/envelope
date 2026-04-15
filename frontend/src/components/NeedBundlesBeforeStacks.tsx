import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import { UNASSIGNED_ENV_SLUG } from "@/projectEnv";

type Props = {
  projectSlug: string;
  /** Pass `location` `env` search value when present (omit or unassigned → new bundle without preset env). */
  envSearch?: string;
};

/**
 * Callout when the project has no bundles yet — stacks need bundle layers.
 */
export function NeedBundlesBeforeStacks({ projectSlug, envSearch = "" }: Props) {
  const e = envSearch.trim();
  const sp = new URLSearchParams();
  if (e && e !== UNASSIGNED_ENV_SLUG) sp.set("env", e);
  const qs = sp.toString();
  const enc = encodeURIComponent(projectSlug);
  const newBundleHref = `/projects/${enc}/bundles/new${qs ? `?${qs}` : ""}`;
  const bundlesHref = `/projects/${enc}/bundles${qs ? `?${qs}` : ""}`;

  return (
    <div
      className="rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-4 text-sm text-slate-200 shadow-sm"
      role="status"
    >
      <p className="text-base font-medium text-amber-100">Create bundles first</p>
      <p className="mt-2 leading-relaxed text-slate-300">
        A <strong className="text-slate-100">stack</strong> is an ordered list of <strong className="text-slate-100">bundle</strong>{" "}
        layers. Add at least one bundle to this project, then you can define stacks that reference those bundles.
      </p>
      <p className="mt-2 text-xs text-slate-500">Order: environments → bundles → stacks.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={newBundleHref}>
          <Button type="button">New bundle</Button>
        </Link>
        <Link to={bundlesHref}>
          <Button type="button" variant="secondary">
            View bundles
          </Button>
        </Link>
      </div>
    </div>
  );
}
