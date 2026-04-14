import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createBundle, type ImportKind } from "@/api/bundles";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function NewBundlePage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [importKind, setImportKind] = useState<ImportKind>("skip");
  const [initialPaste, setInitialPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      await createBundle({
        name: name.trim(),
        project_slug: projectSlug,
        ...(importKind === "skip" || !initialPaste.trim()
          ? {}
          : { initial_paste: initialPaste, import_kind: importKind }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bundles"] });
      navigate(
        `/projects/${encodeURIComponent(projectSlug)}/bundles/${encodeURIComponent(name.trim())}/edit`,
      );
    },
    onError: (e: unknown) => {
      setError(formatApiError(e));
    },
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold text-white">New bundle</h1>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label htmlFor="bn" className="mb-1 block text-sm text-slate-400">
            Bundle name
          </label>
          <input
            id="bn"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            pattern="[a-zA-Z0-9._\-]+"
            placeholder="myapp-prod"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-400">Initial variables</legend>
          <label className="flex gap-2 text-sm">
            <input
              type="radio"
              name="ik"
              checked={importKind === "skip"}
              onChange={() => setImportKind("skip")}
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
          <Button type="submit" disabled={m.isPending || !name.trim()}>
            {m.isPending ? "Creating…" : "Create"}
          </Button>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/bundles`}>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
