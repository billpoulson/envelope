import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { getStack, getStackKeyGraph } from "@/api/stacks";
import { StackKeyGraphView } from "@/components/StackKeyGraphView";
import { StackPageShell } from "@/components/StackPageShell";
import { PickEnvironmentForAmbiguousResource } from "@/components/PickEnvironmentForAmbiguousResource";
import { projectStacksBase, resourceScopeFromPath, searchWithoutEnv } from "@/projectPaths";
import { isAmbiguousStackScopeError, resourceScopeQueryRetry } from "@/util/ambiguousScopeError";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-slate-400">
      {children}
    </div>
  );
}

export default function StackKeyGraphPage() {
  const { projectSlug: projectSlugParam, environmentSlug = "", stackName = "" } = useParams<{
    projectSlug?: string;
    environmentSlug?: string;
    stackName: string;
  }>();
  const location = useLocation();
  const resourceScope = resourceScopeFromPath(projectSlugParam, environmentSlug);
  const qc = useQueryClient();
  const [showSecrets, setShowSecrets] = useState(false);
  const stackQ = useQuery({
    queryKey: ["stack", stackName, projectSlugParam ?? "", environmentSlug],
    queryFn: () => getStack(stackName, resourceScope),
    enabled: !!stackName,
    retry: resourceScopeQueryRetry,
  });
  const q = useQuery({
    queryKey: ["stack-key-graph", stackName, showSecrets, projectSlugParam ?? "", environmentSlug],
    queryFn: () => getStackKeyGraph(stackName, showSecrets, resourceScope),
    enabled: !!stackName && stackQ.isSuccess,
    retry: resourceScopeQueryRetry,
  });

  if (!stackName) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="text-red-400">Missing stack</p>
      </div>
    );
  }
  if (stackQ.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Centered>Loading…</Centered>
      </div>
    );
  }
  if (stackQ.isError) {
    if (projectSlugParam && isAmbiguousStackScopeError(stackQ.error)) {
      return (
        <PickEnvironmentForAmbiguousResource
          projectSlug={projectSlugParam}
          kind="stack"
          resourceSegment={stackName}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Centered>
          <span className="text-red-400">
            {stackQ.error instanceof Error ? stackQ.error.message : "Failed"}
          </span>
        </Centered>
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Centered>Loading graph…</Centered>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Centered>
          <span className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</span>
        </Centered>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Centered>Loading graph…</Centered>
      </div>
    );
  }

  const data = q.data;
  const projectSlug = projectSlugParam ?? stackQ.data.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const editTo =
    projectSlug && environmentSlug
      ? `${projectStacksBase(projectSlug, environmentSlug)}/${encodeURIComponent(stackName)}/edit`
      : `/stacks/${encodeURIComponent(stackName)}/edit`;

  return (
    <StackPageShell
      stackName={stackName}
      displayName={stackQ.data?.name}
      subnavSlug={subnavSlug}
      subnavEnvironmentSlug={environmentSlug}
      linkSearch={searchWithoutEnv(location.search)}
      subtitle="Key graph — merged variables by layer"
      tertiaryLink={{ to: `${editTo}${searchWithoutEnv(location.search)}`, label: "← Edit stack layers" }}
      fullBleed
    >
      <StackKeyGraphView
        data={data}
        stackName={stackName}
        projectSlug={projectSlugParam ?? projectSlug}
        stackScope={resourceScope}
        stackLayers={stackQ.data?.layers ?? []}
        showSecrets={showSecrets}
        onShowSecretsChange={setShowSecrets}
        onRefetch={() => {
          void qc.invalidateQueries({
            queryKey: ["stack-key-graph", stackName, showSecrets, projectSlugParam ?? "", environmentSlug],
          });
          void qc.invalidateQueries({
            queryKey: ["stack", stackName, projectSlugParam ?? "", environmentSlug],
          });
        }}
      />
    </StackPageShell>
  );
}
