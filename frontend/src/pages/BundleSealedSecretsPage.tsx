import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  deleteSealedSecret,
  getBundle,
  listSealedSecrets,
  upsertSealedSecret,
  type SealedRecipientIn,
} from "@/api/bundles";
import { listCertificates } from "@/api/certificates";
import { BundleSubnav } from "@/components/BundleSubnav";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

const STEPS = 4;

function previewBlob(s: string, maxLen: number) {
  const t = (s || "").trim();
  if (!t) return "—";
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}

export default function BundleSealedSecretsPage() {
  const { projectSlug: projectSlugParam, bundleName = "" } = useParams<{
    projectSlug?: string;
    bundleName: string;
  }>();
  const qc = useQueryClient();
  const bq = useQuery({
    queryKey: ["bundle", bundleName],
    queryFn: () => getBundle(bundleName),
    enabled: !!bundleName && !projectSlugParam,
  });
  const q = useQuery({
    queryKey: ["sealed", bundleName],
    queryFn: () => listSealedSecrets(bundleName),
    enabled: !!bundleName,
  });
  const certQ = useQuery({
    queryKey: ["certificates"],
    queryFn: listCertificates,
  });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [keyName, setKeyName] = useState("");
  const [encAlg, setEncAlg] = useState("aes-256-gcm");
  const [payloadCt, setPayloadCt] = useState("");
  const [payloadNonce, setPayloadNonce] = useState("");
  const [payloadAad, setPayloadAad] = useState("");
  const [recipientsJson, setRecipientsJson] = useState(
    '[{"certificate_id":1,"wrapped_key":"","key_wrap_alg":"rsa-oaep-256"}]',
  );
  const [wizardErr, setWizardErr] = useState<string | null>(null);

  const delM = useMutation({
    mutationFn: (kn: string) => deleteSealedSecret(bundleName, kn),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sealed", bundleName] }),
  });

  const saveM = useMutation({
    mutationFn: async () => {
      let recipients: SealedRecipientIn[];
      try {
        const parsed = JSON.parse(recipientsJson.trim()) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Recipients must be a non-empty JSON array.");
        }
        recipients = parsed.map((r, i) => {
          if (!r || typeof r !== "object") throw new Error(`Invalid recipient at index ${i}`);
          const o = r as Record<string, unknown>;
          const cid = o.certificate_id;
          const wk = o.wrapped_key;
          const ka = o.key_wrap_alg;
          if (typeof cid !== "number" || typeof wk !== "string" || typeof ka !== "string") {
            throw new Error(`Recipient ${i}: need certificate_id (number), wrapped_key, key_wrap_alg`);
          }
          return {
            certificate_id: cid,
            wrapped_key: wk.trim(),
            key_wrap_alg: ka.trim(),
          };
        });
      } catch (e: unknown) {
        throw new Error(e instanceof Error ? e.message : "Invalid recipients JSON");
      }
      await upsertSealedSecret(bundleName, {
        key_name: keyName.trim(),
        enc_alg: encAlg.trim(),
        payload_ciphertext: payloadCt.trim(),
        payload_nonce: payloadNonce.trim(),
        payload_aad: payloadAad.trim() ? payloadAad.trim() : null,
        recipients,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sealed", bundleName] });
      setWizardOpen(false);
      setStep(1);
      setWizardErr(null);
      setKeyName("");
      setPayloadCt("");
      setPayloadNonce("");
      setPayloadAad("");
    },
    onError: (e: unknown) => setWizardErr(formatApiError(e)),
  });

  function validateStep(n: number): boolean {
    setWizardErr(null);
    if (n === 1) {
      if (!keyName.trim()) {
        setWizardErr("Enter a key name.");
        return false;
      }
      return true;
    }
    if (n === 2) {
      if (!encAlg.trim() || !payloadCt.trim() || !payloadNonce.trim()) {
        setWizardErr("Algorithm, ciphertext, and nonce are required.");
        return false;
      }
      return true;
    }
    if (n === 3) {
      try {
        const parsed = JSON.parse(recipientsJson.trim()) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setWizardErr("Recipients must be a non-empty JSON array.");
          return false;
        }
      } catch {
        setWizardErr("Recipients must be valid JSON.");
        return false;
      }
      return true;
    }
    return true;
  }

  function openWizard() {
    setWizardOpen(true);
    setStep(1);
    setWizardErr(null);
  }

  if (!bundleName) return <p className="text-red-400">Missing bundle</p>;
  if (!projectSlugParam && bq.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (!projectSlugParam && bq.isError) {
    return (
      <p className="text-red-400">{bq.error instanceof Error ? bq.error.message : "Failed"}</p>
    );
  }
  const projectSlug = projectSlugParam ?? bq.data?.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const editTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/bundles/${encodeURIComponent(bundleName)}/edit`
    : `/bundles/${encodeURIComponent(bundleName)}/edit`;

  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];
  const certs = certQ.data ?? [];
  const canSubmitWizard = certs.length > 0;

  return (
    <div>
      <h1 className="mb-2 font-mono text-2xl font-semibold text-white">{bundleName}</h1>
      <BundleSubnav projectSlug={subnavSlug} bundleName={bundleName} />
      <p className="mb-4 text-slate-400">
        <Link to={editTo}>← Variables</Link>
      </p>

      <p className="mb-4 text-sm text-slate-400">
        Upload client-encrypted payloads and wrapped data keys for certificate recipients. The server stores
        ciphertext only (same model as the classic UI).
      </p>

      {certs.length === 0 ? (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          No certificates registered. Add at least one on the{" "}
          <Link className="underline" to="/certificates">
            Certificates
          </Link>{" "}
          page before creating sealed secrets.
        </p>
      ) : null}

      <div className="mb-6">
        <Button type="button" onClick={openWizard} disabled={!canSubmitWizard}>
          Add or update sealed secret…
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">No sealed secrets yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.key_name} className="rounded-lg border border-border/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-slate-200">{r.key_name}</span>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-red-300"
                  onClick={() => {
                    if (confirm(`Delete sealed secret ${r.key_name}?`)) delM.mutate(r.key_name);
                  }}
                >
                  Delete
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {r.enc_alg} · {r.recipients.length} recipient(s), updated {r.updated_at}
              </p>
            </li>
          ))}
        </ul>
      )}

      {wizardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-[#121820] p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sealed-wizard-title"
          >
            <h2 id="sealed-wizard-title" className="mb-4 text-lg font-semibold text-white">
              Add or update sealed secret
            </h2>
            <ol className="mb-6 flex flex-wrap gap-2 text-xs text-slate-500">
              {Array.from({ length: STEPS }, (_, i) => i + 1).map((n) => (
                <li
                  key={n}
                  className={`rounded px-2 py-1 ${step === n ? "bg-white/10 text-white" : ""}`}
                >
                  {n}. {["Name", "Payload", "Recipients", "Review"][n - 1]}
                </li>
              ))}
            </ol>

            {wizardErr ? <p className="mb-4 text-sm text-red-400">{wizardErr}</p> : null}

            {step === 1 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  Choose the variable key for this sealed secret. Use the same name as an existing row to
                  replace it.
                </p>
                <label className="block text-sm text-slate-400">Key name</label>
                <input
                  className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="MY_CLIENT_SECRET"
                  autoComplete="off"
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">
                  Paste ciphertext and parameters from your client-side sealing tool.
                </p>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Payload algorithm</label>
                  <input
                    className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                    value={encAlg}
                    onChange={(e) => setEncAlg(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Payload ciphertext</label>
                  <textarea
                    className="h-32 w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-xs"
                    value={payloadCt}
                    onChange={(e) => setPayloadCt(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Nonce</label>
                    <input
                      className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-xs"
                      value={payloadNonce}
                      onChange={(e) => setPayloadNonce(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">AAD (optional)</label>
                    <input
                      className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-xs"
                      value={payloadAad}
                      onChange={(e) => setPayloadAad(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  JSON array: one object per recipient with <code className="font-mono">certificate_id</code>,{" "}
                  <code className="font-mono">wrapped_key</code>, <code className="font-mono">key_wrap_alg</code>.
                </p>
                {certs.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    {certs.map((c) => (
                      <span key={c.id} className="rounded border border-border/60 px-2 py-1 font-mono">
                        {c.id} · {c.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <textarea
                  className="h-48 w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-xs"
                  value={recipientsJson}
                  onChange={(e) => setRecipientsJson(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-xs text-slate-500">
                  Need a cert?{" "}
                  <Link className="text-accent underline" to="/certificates">
                    Register one
                  </Link>
                  .
                </p>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-3 text-sm">
                <p className="text-slate-400">Confirm before saving.</p>
                <div className="grid gap-2 rounded-lg border border-border/60 p-4 font-mono text-xs text-slate-300">
                  <div>
                    <span className="text-slate-500">Key:</span> {keyName.trim() || "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Alg:</span> {encAlg.trim() || "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Ciphertext:</span>{" "}
                    {previewBlob(payloadCt, 200)}
                  </div>
                  <div>
                    <span className="text-slate-500">Nonce:</span> {previewBlob(payloadNonce, 120)}
                  </div>
                  <div>
                    <span className="text-slate-500">AAD:</span> {previewBlob(payloadAad, 120)}
                  </div>
                  <div>
                    <span className="text-slate-500">Recipients:</span>{" "}
                    {previewBlob(recipientsJson, 400)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setWizardOpen(false);
                  setStep(1);
                  setWizardErr(null);
                }}
              >
                Cancel
              </Button>
              <div className="flex flex-wrap gap-2">
                {step > 1 ? (
                  <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                    Back
                  </Button>
                ) : null}
                {step < STEPS ? (
                  <Button
                    type="button"
                    onClick={() => {
                      if (!validateStep(step)) return;
                      if (step === 3) setWizardErr(null);
                      setStep((s) => Math.min(STEPS, s + 1));
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={saveM.isPending || !canSubmitWizard}
                    onClick={() => {
                      if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
                        setStep(1);
                        return;
                      }
                      saveM.mutate();
                    }}
                  >
                    {saveM.isPending ? "Saving…" : "Save sealed secret"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
