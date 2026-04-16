import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import { projectBundlesBase } from "@/projectPaths";

type Props = {
  projectSlug: string;
  environmentSlug: string;
};

/**
 * Callout when the project has no bundles yet — stacks need bundle layers.
 */
export function NeedBundlesBeforeStacks({ projectSlug, environmentSlug }: Props) {
  const base = projectBundlesBase(projectSlug, environmentSlug);

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
        <Link to={`${base}/new`}>
          <Button type="button">New bundle</Button>
        </Link>
        <Link to={base}>
          <Button type="button" variant="secondary">
            View bundles
          </Button>
        </Link>
      </div>
    </div>
  );
}
