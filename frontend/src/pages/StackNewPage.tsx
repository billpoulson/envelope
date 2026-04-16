import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { createStack, type StackLayer } from "@/api/stacks";
import { environmentListApiOpts } from "@/projectEnv";
import { projectStacksBase, searchWithoutEnv } from "@/projectPaths";
import { NeedBundlesForStack } from "@/components/NeedBundlesForStack";
import { NeedProjectEnvironments } from "@/components/NeedProjectEnvironments";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

export default function StackNewPage() {
  const { projectSlug = "", environmentSlug = "" } = useParams<{
    projectSlug: string;
    environmentSlug: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [bundle, setBundle] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
  }, [projectSlug, environmentSlug, location.key]);

  const listOpts = environmentListApiOpts(environmentSlug);
  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlug, environmentSlug],
    queryFn: () => listBundles(projectSlug, listOpts),
    enabled: !!projectSlug && !!environmentSlug,
  });
  const bundleNames = useMemo(() => {
    const raw = bundlesQ.data ?? [];
    return [...raw].sort((a, b) => a.localeCompare(b));
  }, [bundlesQ.data]);

  const canSubmit = !!name.trim() && !!bundle.trim() && !!environmentSlug.trim();

  const m = useMutation({
    mutationFn: async () => {
      const envSlug = environmentSlug.trim();
      const displayName = name.trim();
      const slugTrim = slug.trim();
      const bottomBundle = bundle.trim();
      if (!envSlug) {
        throw new Error("Missing environment in URL.");
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
      return { stackSlug: created.slug };
    },
    onSuccess: async ({ stackSlug }) => {
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      const qs = searchWithoutEnv(location.search);
      navigate({
        pathname: `${projectStacksBase(projectSlug, environmentSlug)}/${encodeURIComponent(stackSlug)}/edit`,
        search: qs,
      });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (!projectSlug || !environmentSlug) return <p className="text-red-400">Missing project or environment</p>;

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
    !!environmentSlug && !bundlesLoading && !bundlesError && bundleNames.length > 0;

  const envLabel = (envsQ.data ?? []).find((e) => e.slug === environmentSlug)?.name ?? environmentSlug;

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
        <p className="text-sm text-slate-400">
          Environment: <span className="font-medium text-slate-200">{envLabel}</span>{" "}
          <span className="font-mono text-xs text-slate-500">({environmentSlug})</span>
        </p>

        {bundlesLoading ? (
          <p className="text-sm text-slate-500">Loading bundles…</p>
        ) : bundlesError ? (
          <p className="text-sm text-red-400">{bundlesError}</p>
        ) : bundleNames.length === 0 ? (
          <NeedBundlesForStack projectSlug={projectSlug} environmentSlug={environmentSlug} />
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
              <Link to={`${projectStacksBase(projectSlug, environmentSlug)}${searchWithoutEnv(location.search)}`}>
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
