import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { createBundle, type ImportKind } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { NeedProjectEnvironments } from "@/components/NeedProjectEnvironments";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { projectBundlesBase, searchWithoutEnv } from "@/projectPaths";

export default function NewBundlePage() {
  const { projectSlug = "", environmentSlug = "" } = useParams<{
    projectSlug: string;
    environmentSlug: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [importKind, setImportKind] = useState<ImportKind>("skip");
  const [initialPaste, setInitialPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  }, [projectSlug, environmentSlug, location.key]);

  const canSubmit = !!name.trim() && !!environmentSlug.trim();

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      const trimmedPaste = initialPaste.trim();
      const skipImport = importKind === "skip" || !trimmedPaste;
      const envSlug = environmentSlug.trim();
      const displayName = name.trim();
      const slugTrim = slug.trim();
      if (!envSlug) {
        throw new Error("Missing environment in URL.");
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
      return { bundleSlug: created.slug };
    },
    onSuccess: async ({ bundleSlug }) => {
      await qc.invalidateQueries({ queryKey: ["bundles"] });
      const qs = searchWithoutEnv(location.search);
      navigate({
        pathname: `${projectBundlesBase(projectSlug, environmentSlug)}/${encodeURIComponent(bundleSlug)}/edit`,
        search: qs,
      });
    },
    onError: (e: unknown) => {
      setError(formatApiError(e));
    },
  });

  if (!projectSlug || !environmentSlug) return <p className="text-red-400">Missing project or environment</p>;

  const envsReady = !envsQ.isLoading && !envsQ.isError;
  const noEnvironments = envsReady && (envsQ.data ?? []).length === 0;

  if (noEnvironments) {
    return (
      <div>
        <PageHeader
          title="New bundle"
          below={
            <p className="text-slate-400">
              Bundles store variables under a project <strong className="text-slate-200">environment</strong>.
            </p>
          }
        />
        <div className="mx-auto max-w-lg">
          <NeedProjectEnvironments projectSlug={projectSlug} resource="bundle" />
        </div>
      </div>
    );
  }

  const envLabel = (envsQ.data ?? []).find((e) => e.slug === environmentSlug)?.name ?? environmentSlug;

  return (
    <div>
      <PageHeader title="New bundle" />
      <div className="mx-auto max-w-lg">
        <p className="mb-4 text-sm text-slate-400">
          Environment: <span className="font-medium text-slate-200">{envLabel}</span>{" "}
          <span className="font-mono text-xs text-slate-500">({environmentSlug})</span>
        </p>
        <form
          className="space-y-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            m.mutate();
          }}
        >
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
            <Link to={`${projectBundlesBase(projectSlug, environmentSlug)}${searchWithoutEnv(location.search)}`}>
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
