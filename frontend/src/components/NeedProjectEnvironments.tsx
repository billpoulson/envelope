import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import { projectGatewayPath } from "@/projectPaths";

type Props = {
  projectSlug: string;
  /** Shown on bundle create flow */
  resource: "bundle" | "stack";
};

/**
 * Explains that at least one project environment must exist before creating bundles or stacks,
 * with a primary link to the Environments admin page.
 */
export function NeedProjectEnvironments({ projectSlug, resource }: Props) {
  const envPath = `/projects/${encodeURIComponent(projectSlug)}/environments`;
  const resourceLabel = resource === "bundle" ? "A bundle" : "A stack";
  return (
    <div
      className="rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-4 text-sm text-slate-200 shadow-sm"
      role="status"
    >
      <p className="text-base font-medium text-amber-100">Create an environment first</p>
      <p className="mt-2 leading-relaxed text-slate-300">
        {resourceLabel} is always assigned to a <strong className="text-slate-100">project environment</strong> (for
        example Production or Staging). Add at least one environment to this project, then come back here.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Order: project → environments → bundles → stacks (layers use bundles from the same project).
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={envPath}>
          <Button type="button">Go to Environments</Button>
        </Link>
        <Link to={projectGatewayPath(projectSlug)}>
          <Button type="button" variant="secondary">
            Back to project
          </Button>
        </Link>
      </div>
    </div>
  );
}
