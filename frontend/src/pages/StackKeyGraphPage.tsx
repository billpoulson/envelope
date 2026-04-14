import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getStack, getStackKeyGraph } from "@/api/stacks";
import { StackKeyGraphView } from "@/components/StackKeyGraphView";
import { StackSubnav } from "@/components/StackSubnav";

export default function StackKeyGraphPage() {
  const { projectSlug: projectSlugParam, stackName = "" } = useParams<{
    projectSlug?: string;
    stackName: string;
  }>();
  const qc = useQueryClient();
  const stackQ = useQuery({
    queryKey: ["stack", stackName],
    queryFn: () => getStack(stackName),
    enabled: !!stackName,
  });
  const q = useQuery({
    queryKey: ["stack-key-graph", stackName],
    queryFn: () => getStackKeyGraph(stackName),
    enabled: !!stackName,
  });

  if (!stackName) return <p className="text-red-400">Missing stack</p>;
  if (stackQ.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (stackQ.isError) {
    return (
      <p className="text-red-400">{stackQ.error instanceof Error ? stackQ.error.message : "Failed"}</p>
    );
  }
  if (q.isLoading) return <p className="text-slate-400">Loading graph…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }
  if (!q.data) return <p className="text-slate-400">Loading graph…</p>;

  const data = q.data;
  const projectSlug = projectSlugParam ?? stackQ.data?.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const editTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackName)}/edit`
    : `/stacks/${encodeURIComponent(stackName)}/edit`;

  return (
    <div>
      <h1 className="mb-2 font-mono text-2xl text-white">{stackName} — key graph</h1>
      <StackSubnav projectSlug={subnavSlug} stackName={stackName} />
      <p className="mb-4">
        <Link className="text-accent underline" to={editTo}>
          ← Layers
        </Link>
      </p>
      <StackKeyGraphView
        data={data}
        onRefetch={() => {
          void qc.invalidateQueries({ queryKey: ["stack-key-graph", stackName] });
        }}
      />
    </div>
  );
}
