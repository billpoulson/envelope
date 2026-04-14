import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import {
  deleteStack,
  getStack,
  patchStack,
  type StackDetail,
} from "@/api/stacks";
import {
  editorToStackLayer,
  type LayerEditorState,
  stackLayersFromApi,
  StackLayersEditor,
} from "@/components/StackLayersEditor";
import { StackSubnav } from "@/components/StackSubnav";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function StackEditPage() {
  const { projectSlug: projectSlugParam, stackName = "" } = useParams<{
    projectSlug?: string;
    stackName: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["stack", stackName],
    queryFn: () => getStack(stackName),
    enabled: !!stackName,
  });
  const [layerUi, setLayerUi] = useState<LayerEditorState[]>([]);
  const [rename, setRename] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const projectSlugForBundles = projectSlugParam ?? q.data?.project_slug ?? "";
  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlugForBundles || "global"],
    queryFn: () => listBundles(projectSlugForBundles || undefined),
    enabled: !!stackName && !!q.data,
  });

  useLayoutEffect(() => {
    if (q.data?.layers) {
      setLayerUi(stackLayersFromApi(q.data.layers));
      setRename(q.data.name);
    }
  }, [q.data]);

  const saveM = useMutation({
    mutationFn: async () => {
      const layers = layerUi.map(editorToStackLayer);
      const newName = rename.trim();
      const ps = projectSlugParam ?? q.data?.project_slug ?? "";
      await patchStack(stackName, {
        name: newName !== stackName ? newName : undefined,
        layers,
      });
      return { newName, ps, renamed: newName !== stackName };
    },
    onSuccess: async ({ newName, ps, renamed }) => {
      await qc.invalidateQueries({ queryKey: ["stack"] });
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      setErr(null);
      if (renamed) {
        if (ps) {
          navigate(
            `/projects/${encodeURIComponent(ps)}/stacks/${encodeURIComponent(newName)}/edit`,
            { replace: true },
          );
        } else {
          navigate(`/stacks/${encodeURIComponent(newName)}/edit`, { replace: true });
        }
      }
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: () => deleteStack(stackName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stacks"] });
      const detail = qc.getQueryData<StackDetail>(["stack", stackName]);
      const ps = projectSlugParam ?? detail?.project_slug ?? "";
      window.location.href = ps ? `/projects/${encodeURIComponent(ps)}/stacks` : "/stacks";
    },
  });

  if (!stackName) return <p className="text-red-400">Missing stack</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError || !q.data) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const projectSlug = projectSlugParam ?? q.data.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const stacksListTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks`
    : "/stacks";

  return (
    <div>
      <h1 className="mb-2 font-mono text-2xl text-white">{stackName}</h1>
      <StackSubnav projectSlug={subnavSlug} stackName={stackName} />
      <p className="mb-4 text-slate-400">
        <Link to={stacksListTo}>← Stacks</Link>
      </p>
      {err ? <p className="mb-4 text-red-400">{err}</p> : null}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-slate-400">Rename</label>
        <input
          className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
          value={rename}
          onChange={(e) => setRename(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <h2 className="mb-2 text-lg text-white">Layers</h2>
        {bundlesQ.isError ? (
          <p className="mb-2 text-sm text-amber-400">
            Could not load bundle list:{" "}
            {bundlesQ.error instanceof Error ? bundlesQ.error.message : String(bundlesQ.error)}
          </p>
        ) : null}
        <StackLayersEditor
          bundleNames={bundlesQ.data ?? []}
          layers={layerUi}
          onChange={setLayerUi}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saveM.isPending} onClick={() => saveM.mutate()}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="text-red-300"
          onClick={() => {
            if (confirm(`Delete stack ${stackName}?`)) delM.mutate();
          }}
        >
          Delete stack
        </Button>
      </div>
    </div>
  );
}
