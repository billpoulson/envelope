import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { fetchCsrf, getOidcLinkStatus, unlinkOidc } from "@/api/auth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { useState } from "react";

export default function AccountPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  const linkedOk = searchParams.get("oidc_linked");
  const acctErr = searchParams.get("oidc_error");

  const q = useQuery({ queryKey: ["oidc-status"], queryFn: getOidcLinkStatus });

  const unlinkM = useMutation({
    mutationFn: async () => {
      const csrf = await fetchCsrf();
      await unlinkOidc(csrf);
    },
    onSuccess: async () => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["oidc-status"] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">
        {q.error instanceof Error ? q.error.message : "Failed to load account"}
      </p>
    );
  }

  const st = q.data!;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Account"
        below={
          <p className="text-slate-400">
            Link OpenID Connect to the API key you used to sign in. SSO sign-in will then use that same key.
          </p>
        }
      />

      <section className="max-w-xl space-y-6 rounded-xl border border-border/70 bg-[#0b0f14]/50 p-6">
        <h2 className="text-lg font-medium text-white">OpenID Connect</h2>

        {linkedOk ? (
          <p className="text-sm text-emerald-400/90">SSO is now linked to your current API key.</p>
        ) : null}
        {acctErr === "linked_other" ? (
          <p className="text-sm text-red-400">
            That IdP account is already linked to a different API key. Unlink it there or use another account.
          </p>
        ) : null}
        {acctErr === "session" ? (
          <p className="text-sm text-red-400">Link session expired. Try Connect SSO again.</p>
        ) : null}

        {st.linked ? (
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              <span className="text-slate-500">Issuer:</span>{" "}
              <span className="font-mono text-xs text-slate-200">{st.issuer ?? "—"}</span>
            </p>
            {st.email ? (
              <p>
                <span className="text-slate-500">Email:</span> {st.email}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={unlinkM.isPending}
              onClick={() => unlinkM.mutate()}
            >
              {unlinkM.isPending ? "Disconnecting…" : "Disconnect SSO"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Not linked yet. You must be signed in with an admin API key. You will be redirected to your identity
              provider to confirm.
            </p>
            <a
              href="/api/v1/auth/oidc/link"
              className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-[#0b0f14] hover:opacity-90"
            >
              Connect SSO
            </a>
          </div>
        )}

        {err ? <p className="text-sm text-red-400">{err}</p> : null}
      </section>
    </div>
  );
}
