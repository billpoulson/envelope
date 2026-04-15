import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { createStack, type StackLayer } from "@/api/stacks";
import { envSearchParam, environmentListApiOpts, UNASSIGNED_ENV_SLUG } from "@/projectEnv";
import { NeedBundlesForStack } from "@/components/NeedBundlesForStack";
import { NeedProjectEnvironments } from "@/components/NeedProjectEnvironments";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

export default function StackNewPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [bundle, setBundle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [selectedEnvSlug, setSelectedEnvSlug] = useState("");

  const envFromUrl = useMemo(() => {
    const e = envSearchParam(searchParams.get("env")) ?? "";
    if (!e || e === UNASSIGNED_ENV_SLUG) return "";
    return e;
  }, [searchParams]);

  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: !!projectSlug,
  });

  useLayoutEffect(() => {
    setName("");
    setSlug("");
    setBundle("");
    setErr(null);
  }, [projectSlug, location.key]);

  useLayoutEffect(() => {
    setSelectedEnvSlug(envFromUrl);
    setBundle("");
  }, [envFromUrl]);

  const listOpts = environmentListApiOpts(selectedEnvSlug || undefined);
  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlug, selectedEnvSlug],
    queryFn: () => listBundles(projectSlug, listOpts),
    enabled: !!projectSlug && !!selectedEnvSlug,
  });
  const bundleNames = useMemo(() => {
    const raw = bundlesQ.data ?? [];
    return [...raw].sort((a, b) => a.localeCompare(b));
  }, [bundlesQ.data]);

  const canSubmit =
    !!name.trim() && !!selectedEnvSlug.trim() && !!bundle.trim();

  const m = useMutation({
    mutationFn: async () => {
      const envSlug = selectedEnvSlug.trim();
      const displayName = name.trim();
      const slugTrim = slug.trim();
      const bottomBundle = bundle.trim();
      if (!envSlug) {
        throw new Error("Select an environment for this stack.");
      }
      if (!bottomBundle) {
        throw new Error("Select a bottom bundle.");
      }
      const created = await createStack({
        name: displayName,
        ...(slugTrim ? { slug: slugTrim } : {}),
        project_slug: projectSlug,
        project_environment_slug: envSlug,
        layers: [{ bundle: bottomBundle, keys: "*" } satisfies StackLayer],
      });
      return { envSlug, stackSlug: created.slug };
    },
    onSuccess: async ({ envSlug, stackSlug }) => {
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      const sp = new URLSearchParams(location.search);
      sp.set("env", envSlug);
      const qs = sp.toString();
      navigate({
        pathname: `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackSlug)}/edit`,
        search: qs ? `?${qs}` : "",
      });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;

  const envsReady = !envsQ.isLoading && !envsQ.isError;
  const noEnvironments = envsReady && (envsQ.data ?? []).length === 0;

  if (noEnvironments) {
    return (
      <div>
        <PageHeader
          title="New stack"
          below={
            <p className="text-slate-400">
              Stacks merge bundle layers and are tagged to a project <strong className="text-slate-200">environment</strong>.
            </p>
          }
        />
        <div className="mx-auto max-w-lg">
          <NeedProjectEnvironments projectSlug={projectSlug} resource="stack" />
        </div>
      </div>
    );
  }

  const bundlesLoading = bundlesQ.isLoading;
  const bundlesError =
    bundlesQ.isError && bundlesQ.error instanceof Error ? bundlesQ.error.message : null;
  const canPickBundle =
    !!selectedEnvSlug &&
    !bundlesLoading &&
    !bundlesError &&
    bundleNames.length > 0;

  const envSelectBlock = (
    <div>
      <label htmlFor="stack-create-env" className="mb-1 block text-sm text-slate-400">
        Environment
      </label>
      {envsQ.isLoading ? (
        <p className="text-sm text-slate-500">Loading environments…</p>
      ) : envsQ.isError ? (
        <p className="text-sm text-red-400">
          {envsQ.error instanceof Error ? envsQ.error.message : "Failed to load environments"}
        </p>
      ) : (
        <select
          id="stack-create-env"
          className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
          value={selectedEnvSlug}
          onChange={(e) => {
            setSelectedEnvSlug(e.target.value);
            setBundle("");
            setErr(null);
          }}
        >
          <option value="">Select environment…</option>
          {(envsQ.data ?? []).map((row) => (
            <option key={row.id} value={row.slug}>
              {row.name}
            </option>
          ))}
        </select>
      )}
      <p className="mt-1 text-xs text-slate-500">
        The stack is tagged to this environment for its lifetime (it cannot be reassigned later).
      </p>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="New stack"
        below={
          <p className="text-sm text-slate-400">
            Start with one layer (bottom) from a bundle in this project. You can add layers and key picks on the edit
            page.
          </p>
        }
      />
      <div className="mx-auto max-w-lg space-y-6">
        {envSelectBlock}

        {!selectedEnvSlug ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Select an environment to continue.</p>
            <Link to={`/projects/${encodeURIComponent(projectSlug)}/stacks${location.search}`}>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        ) : bundlesLoading ? (
          <p className="text-sm text-slate-500">Loading bundles…</p>
        ) : bundlesError ? (
          <p className="text-sm text-red-400">{bundlesError}</p>
        ) : bundleNames.length === 0 ? (
          <NeedBundlesForStack projectSlug={projectSlug} environmentSlug={selectedEnvSlug} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              m.mutate();
            }}
          >
            <div>
              <label className="mb-1 block text-sm text-slate-400" htmlFor="stack-new-name">
                Name
              </label>
              <input
                id="stack-new-name"
                className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-500">
                Display title. Spaces and punctuation are fine. Not allowed:{" "}
                <span className="font-mono">/ \ : * ? &quot; &lt; &gt; |</span>
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400" htmlFor="stack-new-slug">
                Slug <span className="font-normal text-slate-600">(optional)</span>
              </label>
              <input
                id="stack-new-slug"
                className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="Derived from name if empty"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-slate-500">
                URL segment: lowercase letters, numbers, <code className="text-slate-400">.</code>,{" "}
                <code className="text-slate-400">_</code>, <code className="text-slate-400">-</code>
              </p>
            </div>
            <div>
              <label htmlFor="stack-bottom-bundle" className="mb-1 block text-sm text-slate-400">
                Bottom bundle
              </label>
              <select
                id="stack-bottom-bundle"
                className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
                value={bundle}
                onChange={(e) => setBundle(e.target.value)}
                required
              >
                <option value="">Select a bundle…</option>
                {bundleNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {err ? <p className="text-sm text-red-400">{err}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={m.isPending || !canSubmit || !canPickBundle}>
                Create
              </Button>
              <Link to={`/projects/${encodeURIComponent(projectSlug)}/stacks${location.search}`}>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
