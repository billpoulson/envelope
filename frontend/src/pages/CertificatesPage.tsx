import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createCertificate, deleteCertificate, listCertificates } from "@/api/certificates";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function CertificatesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["certificates"], queryFn: listCertificates });
  const [name, setName] = useState("");
  const [pem, setPem] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () =>
      createCertificate({ name: name.trim(), certificate_pem: pem.trim() }),
    onSuccess: () => {
      setErr(null);
      setName("");
      setPem("");
      void qc.invalidateQueries({ queryKey: ["certificates"] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: (id: number) => deleteCertificate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["certificates"] }),
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  if (q.isLoading) return <p className="text-slate-400">Loading certificates…</p>;
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
        title="Certificates"
        below={
          <p className="text-slate-400">
            Register recipient certificates for sealed secrets. Used when wrapping data keys for specific
            operators.
          </p>
        }
      />
      <div className="max-w-3xl space-y-8">

      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      <section className="rounded-xl border border-border/80 bg-white/[0.02] p-6">
        <h2 className="mb-4 text-lg text-white">Add certificate</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Name</label>
            <input
              className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="alice-laptop"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Certificate PEM</label>
            <textarea
              className="h-40 w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-xs"
              value={pem}
              onChange={(e) => setPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              spellCheck={false}
            />
          </div>
          <Button
            type="button"
            disabled={createM.isPending || !name.trim() || !pem.trim()}
            onClick={() => createM.mutate()}
          >
            {createM.isPending ? "Saving…" : "Register certificate"}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg text-white">Registered</h2>
        {rows.length === 0 ? (
          <p className="text-slate-400">
            No certificates yet. Add one above, or open the{" "}
            <a className="text-accent underline" href="/help/certificates" target="_blank" rel="noreferrer">
              certificates help
            </a>{" "}
            topic (classic HTML).
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/[0.03] px-4 py-3"
              >
                <div>
                  <div className="font-medium text-slate-200">{c.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    id {c.id} · {c.fingerprint_sha256}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-sm text-red-400 underline"
                  disabled={delM.isPending}
                  onClick={() => {
                    if (confirm(`Delete certificate “${c.name}”?`)) delM.mutate(c.id);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}
