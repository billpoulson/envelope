import { Link } from "react-router-dom";
import { Button } from "@/components/ui";

type Props = {
  projectSlug: string;
  /** Environment slug for `?env=` on the new-bundle link */
  environmentSlug: string;
};

/**
 * Shown when creating a stack but the selected environment has no bundles yet.
 */
export function NeedBundlesForStack({ projectSlug, environmentSlug }: Props) {
  const qs = new URLSearchParams({ env: environmentSlug }).toString();
  const newBundlePath = `/projects/${encodeURIComponent(projectSlug)}/bundles/new?${qs}`;
  const stacksPath = `/projects/${encodeURIComponent(projectSlug)}/stacks`;

  return (
    <div
      className="rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-4 text-sm text-slate-200 shadow-sm"
      role="status"
    >
      <p className="text-base font-medium text-amber-100">Create a bundle first</p>
      <p className="mt-2 leading-relaxed text-slate-300">
        A stack is built from <strong className="text-slate-100">layers</strong>, each referencing a bundle in this
        project. Add at least one bundle in this environment, then return here to create the stack.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Order: environments → bundles → stacks.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={newBundlePath}>
          <Button type="button">New bundle for this environment</Button>
        </Link>
        <Link to={stacksPath}>
          <Button type="button" variant="secondary">
            Back to stacks
          </Button>
        </Link>
      </div>
    </div>
  );
}
