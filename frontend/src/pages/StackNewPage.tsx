import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { createStack, type StackLayer } from "@/api/stacks";
import { envSearchParam, environmentListApiOpts, UNASSIGNED_ENV_SLUG } from "@/projectEnv";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

export default function StackNewPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
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
      const stackNameTrim = name.trim();
      const bottomBundle = bundle.trim();
      if (!envSlug) {
        throw new Error("Select an environment for this stack.");
      }
      if (!bottomBundle) {
        throw new Error("Select a bottom bundle.");
      }
      await createStack({
        name: stackNameTrim,
        project_slug: projectSlug,
        project_environment_slug: envSlug,
        layers: [{ bundle: bottomBundle, keys: "*" } satisfies StackLayer],
      });
      return { envSlug, stackNameTrim };
    },
    onSuccess: async ({ envSlug, stackNameTrim }) => {
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      const sp = new URLSearchParams(location.search);
      sp.set("env", envSlug);
      const qs = sp.toString();
      navigate({
        pathname: `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackNameTrim)}/edit`,
        search: qs ? `?${qs}` : "",
      });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;

  const bundlesLoading = bundlesQ.isLoading;
  const bundlesError =
    bundlesQ.isError && bundlesQ.error instanceof Error ? bundlesQ.error.message : null;
  const canPickBundle =
    !!selectedEnvSlug &&
    !bundlesLoading &&
    !bundlesError &&
    bundleNames.length > 0;
  const newBundleSearch = selectedEnvSlug
    ? `?${new URLSearchParams({ env: selectedEnvSlug }).toString()}`
    : location.search;
  const newBundleHref = `/projects/${encodeURIComponent(projectSlug)}/bundles/new${newBundleSearch}`;

  return (
    <div>
      <PageHeader
        title="New stack"
        below={
          <p className="text-sm text-slate-400">
            Start with one layer (bottom) from a bundle in this project. You can add layers and key picks on
            the edit page.
          </p>
        }
      />
      <div className="mx-auto max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
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
          ) : (envsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">
              No environments in this project yet. Add one under{" "}
              <Link
                className="text-accent underline hover:text-accent/90"
                to={`/projects/${encodeURIComponent(projectSlug)}/environments`}
              >
                Project → Environments
              </Link>
              .
            </p>
          ) : (
            <select
              id="stack-create-env"
              required
              className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={selectedEnvSlug}
              onChange={(e) => {
                setSelectedEnvSlug(e.target.value);
                setBundle("");
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
        <div>
          <label className="mb-1 block text-sm text-slate-400">Stack name</label>
          <input
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Spaces and punctuation are fine. Not allowed:{" "}
            <span className="font-mono">/ \ : * ? &quot; &lt; &gt; |</span>
          </p>
        </div>
        <div>
          <label htmlFor="stack-bottom-bundle" className="mb-1 block text-sm text-slate-400">
            Bottom bundle
          </label>
          {!selectedEnvSlug ? (
            <p className="text-sm text-slate-500">Select an environment to list bundles for that tag.</p>
          ) : bundlesLoading ? (
            <p className="text-sm text-slate-500">Loading bundles…</p>
          ) : bundlesError ? (
            <p className="text-sm text-red-400">{bundlesError}</p>
          ) : bundleNames.length === 0 ? (
            <p className="text-sm text-slate-400">
              No bundles in this environment yet.{" "}
              <Link to={newBundleHref} className="text-accent underline hover:text-accent/90">
                Create a bundle
              </Link>{" "}
              for this environment first.
            </p>
          ) : (
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
          )}
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
      </div>
    </div>
  );
}
