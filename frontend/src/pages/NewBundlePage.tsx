import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createBundle, type ImportKind } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { envSearchParam, UNASSIGNED_ENV_SLUG } from "@/projectEnv";
import { NeedProjectEnvironments } from "@/components/NeedProjectEnvironments";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function NewBundlePage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [importKind, setImportKind] = useState<ImportKind>("skip");
  const [initialPaste, setInitialPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  // Same route element is reused when only :projectSlug changes (or on return navigation); clear stale paste/import.
  useLayoutEffect(() => {
    setName("");
    setSlug("");
    setImportKind("skip");
    setInitialPaste("");
    setError(null);
  }, [projectSlug, location.key]);

  useLayoutEffect(() => {
    setSelectedEnvSlug(envFromUrl);
  }, [envFromUrl]);

  const canSubmit = !!name.trim() && !!selectedEnvSlug;

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      const trimmedPaste = initialPaste.trim();
      const skipImport = importKind === "skip" || !trimmedPaste;
      const envSlug = selectedEnvSlug.trim();
      const displayName = name.trim();
      const slugTrim = slug.trim();
      if (!envSlug) {
        throw new Error("Select an environment for this bundle.");
      }
      const created = await createBundle({
        name: displayName,
        ...(slugTrim ? { slug: slugTrim } : {}),
        project_slug: projectSlug,
        project_environment_slug: envSlug,
        ...(skipImport
          ? { import_kind: "skip" as const }
          : { import_kind: importKind, initial_paste: initialPaste }),
      });
      return { envSlug, bundleSlug: created.slug };
    },
    onSuccess: async ({ envSlug, bundleSlug }) => {
      await qc.invalidateQueries({ queryKey: ["bundles"] });
      const sp = new URLSearchParams(location.search);
      sp.set("env", envSlug);
      const qs = sp.toString();
      navigate({
        pathname: `/projects/${encodeURIComponent(projectSlug)}/bundles/${encodeURIComponent(bundleSlug)}/edit`,
        search: qs ? `?${qs}` : "",
      });
    },
    onError: (e: unknown) => {
      setError(formatApiError(e));
    },
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;

  const envsReady = !envsQ.isLoading && !envsQ.isError;
  const noEnvironments = envsReady && (envsQ.data ?? []).length === 0;

  if (noEnvironments) {
    return (
      <div>
        <PageHeader
          title="New bundle"
          below={
            <p className="text-slate-400">
              Bundles store variables under a project <strong className="text-slate-200">environment</strong> (not the
              same as the nav filter).
            </p>
          }
        />
        <div className="mx-auto max-w-lg">
          <NeedProjectEnvironments projectSlug={projectSlug} resource="bundle" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="New bundle" />
      <div className="mx-auto max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label htmlFor="bundle-create-env" className="mb-1 block text-sm text-slate-400">
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
              id="bundle-create-env"
              required
              className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={selectedEnvSlug}
              onChange={(e) => setSelectedEnvSlug(e.target.value)}
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
            The bundle is tagged to this environment for its lifetime (it cannot be reassigned later).
          </p>
        </div>
        <div>
          <label htmlFor="bn" className="mb-1 block text-sm text-slate-400">
            Name
          </label>
          <input
            id="bn"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Production API"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-slate-500">
            Display title. Avoid: <span className="font-mono">/ \ : * ? &quot; &lt; &gt; |</span>
          </p>
        </div>
        <div>
          <label htmlFor="bundle-new-slug" className="mb-1 block text-sm text-slate-400">
            Slug <span className="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            id="bundle-new-slug"
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
        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-400">Initial variables</legend>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "skip"}
              onChange={() => {
                setImportKind("skip");
                setInitialPaste("");
              }}
            />
            Skip
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "json_object"}
              onChange={() => setImportKind("json_object")}
            />
            JSON object
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "json_array"}
              onChange={() => setImportKind("json_array")}
            />
            JSON array of KEY=value strings
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "csv_quoted"}
              onChange={() => setImportKind("csv_quoted")}
            />
            Comma-separated quoted pairs
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "dotenv_lines"}
              onChange={() => setImportKind("dotenv_lines")}
            />
            Dotenv lines
          </label>
        </fieldset>
        {importKind !== "skip" ? (
          <div>
            <label htmlFor="paste" className="mb-1 block text-sm text-slate-400">
              Paste
            </label>
            <textarea
              id="paste"
              rows={10}
              className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={initialPaste}
              onChange={(e) => setInitialPaste(e.target.value)}
            />
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={m.isPending || !canSubmit}>
            {m.isPending ? "Creating…" : "Create"}
          </Button>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/bundles${location.search}`}>
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
