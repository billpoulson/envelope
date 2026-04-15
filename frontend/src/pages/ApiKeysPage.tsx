import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteApiKey, listApiKeys } from "@/api/keys";
import { ApiKeyCreateWizard } from "@/components/ApiKeyCreateWizard";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const [err, setErr] = useState<string | null>(null);
  const [newPlain, setNewPlain] = useState<string | null>(null);

  const delM = useMutation({
    mutationFn: (id: number) => deleteApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  if (q.isLoading) return <p className="text-slate-400">Loading API keys…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">
        {q.error instanceof Error ? q.error.message : "Failed to load"}
      </p>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="API keys"
        below={
          <p className="text-slate-400">
            Create keys with explicit scopes. The plaintext value is shown only once after creation.
          </p>
        }
      />
      <div className="max-w-3xl space-y-8">
        {err ? <p className="text-sm text-red-400">{err}</p> : null}

        {newPlain ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="mb-2 text-sm font-medium text-amber-100">
              Save this key now — it will not be shown again.
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-white">
              {newPlain}
            </pre>
            <Button type="button" variant="secondary" className="mt-3" onClick={() => setNewPlain(null)}>
              Dismiss
            </Button>
          </div>
        ) : null}

        <ApiKeyCreateWizard
          onCreated={(plain) => {
            setNewPlain(plain);
            setErr(null);
          }}
          onError={setErr}
        />

        <section>
          <h2 className="mb-4 text-lg text-white">Existing keys</h2>
          {rows.length === 0 ? (
            <p className="text-slate-400">No keys yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 bg-white/[0.03] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Scopes</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.id} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-3 text-slate-200">{k.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {k.scopes.join(", ")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="text-sm text-red-400 underline"
                          disabled={delM.isPending}
                          onClick={() => {
                            if (confirm(`Revoke API key “${k.name}”? This cannot be undone.`)) {
                              delM.mutate(k.id);
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
