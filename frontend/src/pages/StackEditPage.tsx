import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
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
import { NeedBundlesBeforeStacks } from "@/components/NeedBundlesBeforeStacks";
import {
  editorToStackLayer,
  type LayerEditorState,
  stackLayersFromApi,
  StackLayersEditor,
} from "@/components/StackLayersEditor";
import { EditNameSlugModal } from "@/components/EditNameSlugModal";
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
  const [displayName, setDisplayName] = useState("");
  const [stackSlug, setStackSlug] = useState("");
  const [stackDetailsOpen, setStackDetailsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const projectSlugForBundles = projectSlugParam ?? q.data?.project_slug ?? "";
  const allBundlesGate = useQuery({
    queryKey: ["bundles", projectSlugParam ?? "", "all-for-stack-gate"],
    queryFn: () => listBundles(projectSlugParam!),
    enabled: !!projectSlugParam && !!stackName,
  });
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
    }
  }, [q.data]);

  useLayoutEffect(() => {
    if (q.data && !stackDetailsOpen) {
      setDisplayName(q.data.name);
      setStackSlug(q.data.slug);
    }
  }, [q.data, stackDetailsOpen]);

  function openStackDetails() {
    if (!q.data) return;
    setErr(null);
    setDisplayName(q.data.name);
    setStackSlug(q.data.slug);
    setStackDetailsOpen(true);
  }

  const saveLayersM = useMutation({
    mutationFn: async () => {
      const detail = q.data;
      if (!detail) throw new Error("Missing stack");
      const layers = layerUi.map(editorToStackLayer);
      await patchStack(stackName, { layers }, resourceScope);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["stack", stackName] });
      await qc.invalidateQueries({ queryKey: ["stack"] });
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const saveDetailsM = useMutation({
    mutationFn: async () => {
      const detail = q.data;
      if (!detail) throw new Error("Missing stack");
      const dn = displayName.trim();
      const ss = stackSlug.trim();
      const body: { name?: string; slug?: string } = {};
      if (dn !== detail.name) body.name = dn;
      if (ss !== detail.slug) body.slug = ss;
      const ps = projectSlugParam ?? detail.project_slug ?? "";
      if (Object.keys(body).length === 0) {
        return { ss, ps, slugChanged: ss !== stackName, skipped: true as const };
      }
      await patchStack(stackName, body, resourceScope);
      return { ss, ps, slugChanged: ss !== stackName, skipped: false as const };
    },
    onSuccess: async (result) => {
      setStackDetailsOpen(false);
      if (result.skipped) return;
      await qc.invalidateQueries({ queryKey: ["stack"] });
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      setErr(null);
      const { ss, ps, slugChanged } = result;
      if (slugChanged) {
        if (ps) {
          navigate(
            `/projects/${encodeURIComponent(ps)}/stacks/${encodeURIComponent(ss)}/edit${location.search}`,
            { replace: true },
          );
        } else {
          navigate(`/stacks/${encodeURIComponent(ss)}/edit${location.search}`, { replace: true });
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

  if (projectSlugParam) {
    if (allBundlesGate.isLoading) return <p className="text-slate-400">Loading…</p>;
    if (allBundlesGate.isError) {
      return (
        <p className="text-red-400">
          {allBundlesGate.error instanceof Error ? allBundlesGate.error.message : "Failed to load bundles"}
        </p>
      );
    }
    if ((allBundlesGate.data?.length ?? 0) === 0) {
      const stacksTo = `/projects/${encodeURIComponent(projectSlugParam)}/stacks${location.search}`;
      return (
        <StackPageShell
          stackName={stackName}
          subnavSlug={projectSlugParam}
          linkSearch={location.search}
          subtitle="Edit stack layers"
          tertiaryLink={{ to: stacksTo, label: "← Stacks" }}
          fullBleed
        >
          <NeedBundlesBeforeStacks projectSlug={projectSlugParam} envSearch={envTag} />
        </StackPageShell>
      );
    }
  }

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
      displayName={q.data.name}
      subnavSlug={subnavSlug}
      linkSearch={location.search}
      subtitle="Edit stack layers"
      tertiaryLink={{ to: `${stacksListTo}${location.search}`, label: "← Stacks" }}
      titleAccessory={
        <button
          type="button"
          className="rounded-md border border-border/60 p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          title="Edit name and slug"
          aria-label="Edit name and slug"
          onClick={openStackDetails}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      }
      fullBleed
    >
      {err && !stackDetailsOpen ? <p className="mb-4 text-red-400">{err}</p> : null}
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
        <Button type="button" disabled={saveLayersM.isPending} onClick={() => saveLayersM.mutate()}>
          {saveLayersM.isPending ? "Saving…" : "Save layers"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="text-red-300"
          onClick={() => {
            if (confirm(`Delete stack “${q.data.name}”?`)) delM.mutate();
          }}
        >
          Delete stack
        </Button>
      </div>

      <EditNameSlugModal
        open={stackDetailsOpen}
        onClose={() => setStackDetailsOpen(false)}
        title="Stack name & slug"
        nameValue={displayName}
        slugValue={stackSlug}
        onNameChange={setDisplayName}
        onSlugChange={setStackSlug}
        onSave={() => saveDetailsM.mutate()}
        savePending={saveDetailsM.isPending}
        error={err}
        saveLabel="Save"
      />
    </StackPageShell>
  );
}
