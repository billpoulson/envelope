import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { login, loginOptions } from "@/api/auth";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const optsQ = useQuery({ queryKey: ["login-options"], queryFn: loginOptions });
  const oidcErr = searchParams.get("oidc_error");
  const oidcInfo = searchParams.get("oidc_info");

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      await login(key.trim());
    },
    onSuccess: () => navigate("/projects", { replace: true }),
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = e.detail;
        setError(typeof d === "string" ? d : JSON.stringify(d));
      } else {
        setError(e instanceof Error ? e.message : "Sign-in failed");
      }
    },
  });

  return (
    <div className="mx-auto max-w-md pt-16">
      <h1 className="mb-2 text-2xl font-semibold text-white">Sign in</h1>
      <p className="mb-6 text-sm text-slate-400">
        Enter an admin API key. The session is stored in a signed browser cookie.
      </p>
      {oidcInfo === "not_configured" ? (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm leading-relaxed text-slate-200">
          <p className="font-medium text-slate-100">SSO is not configured on this server</p>
          <p className="mt-2 text-slate-300">
            An administrator must enable OpenID Connect under App settings (Admin menu) before &quot;Sign in with
            SSO&quot; can work. You can still sign in with an admin API key below.
          </p>
        </div>
      ) : null}
      {oidcErr === "unlinked" ? (
        <p className="mb-4 text-sm text-amber-200/90">
          SSO is not linked yet. Sign in with an admin API key, open{" "}
          <a href="/account" className="text-accent underline">
            Account
          </a>
          , then connect SSO.
        </p>
      ) : null}
      {oidcErr && oidcErr !== "unlinked" ? (
        <p className="mb-4 text-sm text-red-400">
          SSO sign-in did not complete. Try again or use an API key.
        </p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label htmlFor="apikey" className="mb-1 block text-sm text-slate-400">
            API key
          </label>
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={m.isPending || !key.trim()}>
          {m.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {optsQ.data?.oidc_configured ? (
        <p className="mt-8 text-center text-sm text-slate-400">
          <a
            href="/api/v1/auth/oidc/login"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            Sign in with SSO
          </a>
        </p>
      ) : null}
    </div>
  );
}
