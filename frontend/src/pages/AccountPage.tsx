import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchCsrf, getOidcLinkStatus, loginOptions, unlinkOidc } from "@/api/auth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function AccountPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  const linkedOk = searchParams.get("oidc_linked");
  const acctErr = searchParams.get("oidc_error");
  const oidcInfo = searchParams.get("oidc_info");

  const q = useQuery({ queryKey: ["oidc-status"], queryFn: getOidcLinkStatus });
  const optsQ = useQuery({ queryKey: ["login-options"], queryFn: loginOptions });

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

  const configured = optsQ.data?.oidc_configured;
  const showOidcNotConfigured =
    configured === false || (configured === undefined && oidcInfo === "not_configured");

  useEffect(() => {
    if (configured === true && oidcInfo) {
      navigate("/account", { replace: true });
    }
  }, [configured, oidcInfo, navigate]);

  if (q.isLoading || optsQ.isLoading) return <p className="text-slate-400">Loading…</p>;
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

        {optsQ.isError ? (
          <p className="text-sm text-amber-200/90">
            Could not check whether SSO is configured. Refresh the page or try again later.
          </p>
        ) : null}

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
          <div className="space-y-4">
            {showOidcNotConfigured ? (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm leading-relaxed text-slate-200">
                <p className="font-medium text-slate-100">SSO is not configured on this server</p>
                <p className="mt-2 text-slate-300">
                  An administrator must enable OpenID Connect under{" "}
                  <strong className="text-slate-100">App settings</strong> (issuer URL, client ID, and client secret)
                  before you can connect SSO here.
                </p>
                <p className="mt-3">
                  <Link to="/settings" className="font-medium text-accent underline hover:no-underline">
                    Open App settings
                  </Link>
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {err ? <p className="text-sm text-red-400">{err}</p> : null}
      </section>
    </div>
  );
}
