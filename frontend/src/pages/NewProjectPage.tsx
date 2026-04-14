import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, getCsrfHeader } from "@/api/client";
import { fetchCsrf } from "@/api/auth";
import { Button } from "@/components/ui";

export default function NewProjectPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      const csrf = await fetchCsrf();
      await apiFetch("/projects", {
        method: "POST",
        headers: getCsrfHeader(csrf),
        json: { name: name.trim(), slug: slug.trim() || null },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold text-white">New project</h1>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label htmlFor="name" className="mb-1 block text-sm text-slate-400">
            Name
          </label>
          <input
            id="name"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="slug" className="mb-1 block text-sm text-slate-400">
            Slug (optional)
          </label>
          <input
            id="slug"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{String(error)}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={m.isPending || !name.trim()}>
            {m.isPending ? "Creating…" : "Create"}
          </Button>
          <Link to="/projects">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
