import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
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
import { StackPageShell } from "@/components/StackPageShell";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { envSearchParam, resourceScopeFromNav, UNASSIGNED_ENV_SLUG } from "@/projectEnv";

function envSlugForLayerKeys(
  detail: StackDetail | undefined,
  urlEnv: string | null,
): string | undefined {
  const u = urlEnv?.trim();
  if (u) return u;
  if (!detail) return undefined;
  if (detail.project_environment_slug) return detail.project_environment_slug;
  if (detail.project_environment_slug === null) return UNASSIGNED_ENV_SLUG;
  return undefined;
}

export default function StackEditPage() {
  const { projectSlug: projectSlugParam, stackName = "" } = useParams<{
    projectSlug?: string;
    stackName: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["stack", stackName, projectSlugParam ?? "", envTag ?? ""],
    queryFn: () => getStack(stackName, resourceScopeFromNav(projectSlugParam, envTag)),
    enabled: !!stackName,
  });
  const resourceScope = resourceScopeFromNav(projectSlugParam, envTag);
  const [layerUi, setLayerUi] = useState<LayerEditorState[]>([]);
  const [rename, setRename] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const projectSlugForBundles = projectSlugParam ?? q.data?.project_slug ?? "";
  const stackEnvSlug = q.data?.project_environment_slug ?? undefined;
  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlugForBundles || "global", stackEnvSlug ?? ""],
    queryFn: () => {
      if (!projectSlugForBundles) return listBundles();
      if (stackEnvSlug) {
        return listBundles(projectSlugForBundles, { environmentSlug: stackEnvSlug });
      }
      return listBundles(projectSlugForBundles);
    },
    enabled: !!stackName && !!q.data,
  });

  const projectSlugResolved = projectSlugParam ?? q.data?.project_slug ?? "";
  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlugResolved],
    queryFn: () => listProjectEnvironments(projectSlugResolved),
    enabled: !!stackName && !!projectSlugResolved && !!q.data,
  });
  const patchStackEnvM = useMutation({
    mutationFn: (slug: string | null) =>
      patchStack(stackName, { project_environment_slug: slug }, resourceScope),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["stack", stackName] });
      await qc.invalidateQueries({ queryKey: ["bundles"] });
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
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
      await patchStack(
        stackName,
        {
          name: newName !== stackName ? newName : undefined,
          layers,
        },
        resourceScope,
      );
      return { newName, ps, renamed: newName !== stackName };
    },
    onSuccess: async ({ newName, ps, renamed }) => {
      await qc.invalidateQueries({ queryKey: ["stack"] });
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      setErr(null);
      if (renamed) {
        if (ps) {
          navigate(
            `/projects/${encodeURIComponent(ps)}/stacks/${encodeURIComponent(newName)}/edit${location.search}`,
            { replace: true },
          );
        } else {
          navigate(`/stacks/${encodeURIComponent(newName)}/edit${location.search}`, { replace: true });
        }
      }
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: () => deleteStack(stackName, resourceScope),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stacks"] });
      const detail = qc.getQueryData<StackDetail>([
        "stack",
        stackName,
        projectSlugParam ?? "",
        envTag ?? "",
      ]);
      const ps = projectSlugParam ?? detail?.project_slug ?? "";
      window.location.href = ps
        ? `/projects/${encodeURIComponent(ps)}/stacks${location.search}`
        : "/stacks";
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
  const envAssignmentLocked = q.data.project_environment_slug != null;
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const stacksListTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks`
    : "/stacks";

  return (
    <StackPageShell
      stackName={stackName}
      subnavSlug={subnavSlug}
      linkSearch={location.search}
      subtitle="Edit stack layers"
      tertiaryLink={{ to: `${stacksListTo}${location.search}`, label: "← Stacks" }}
      fullBleed
    >
      {err ? <p className="mb-4 text-red-400">{err}</p> : null}
      {projectSlugResolved && !envAssignmentLocked ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Environment</span>
          <span className="text-xs text-slate-500">(set once; cannot be changed afterward)</span>
          <select
            className="w-full max-w-xs rounded-md border border-border bg-[#0b0f14] px-2 py-1 font-mono text-sm text-slate-200"
            value={q.data.project_environment_slug ?? ""}
            disabled={envsQ.isLoading || patchStackEnvM.isPending}
            onChange={(e) => {
              const v = e.target.value;
              patchStackEnvM.mutate(v === "" ? null : v);
            }}
          >
            <option value="">Unassigned</option>
            {(envsQ.data ?? []).map((row) => (
              <option key={row.id} value={row.slug}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
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
          bundleKeyScope={resourceScopeFromNav(
            projectSlugForBundles,
            envSlugForLayerKeys(q.data, envTag || null),
          )}
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
    </StackPageShell>
  );
}
