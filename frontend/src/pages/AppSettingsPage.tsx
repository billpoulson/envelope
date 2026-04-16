import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getOidcSettings, patchOidcSettings, type OidcSettings } from "@/api/settings";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

function formFromApi(s: OidcSettings) {
  return {
    enabled: s.enabled,
    issuer: s.issuer,
    client_id: s.client_id,
    client_secret: "",
    scopes: s.scopes,
    allowed_email_domains: s.allowed_email_domains,
    post_login_path: s.post_login_path,
    proxy_admin_key_id: s.proxy_admin_key_id != null ? String(s.proxy_admin_key_id) : "",
    redirect_uri_override: s.redirect_uri_override ?? "",
  };
}

export default function AppSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings", "oidc"], queryFn: getOidcSettings });
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof formFromApi> | null>(null);

  useEffect(() => {
    if (q.data) setForm(formFromApi(q.data));
  }, [q.data]);

  const saveM = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Form not ready");
      const proxyRaw = form.proxy_admin_key_id.trim();
      const proxy =
        proxyRaw === "" ? null : Number.parseInt(proxyRaw, 10);
      if (proxyRaw !== "" && Number.isNaN(proxy)) {
        throw new Error("Proxy admin key id must be a number");
      }
      return patchOidcSettings({
        enabled: form.enabled,
        issuer: form.issuer.trim(),
        client_id: form.client_id.trim(),
        client_secret: form.client_secret.trim() === "" ? undefined : form.client_secret,
        scopes: form.scopes.trim(),
        allowed_email_domains: form.allowed_email_domains.trim(),
        post_login_path: form.post_login_path.trim(),
        proxy_admin_key_id: proxy,
        redirect_uri_override: form.redirect_uri_override.trim() === "" ? null : form.redirect_uri_override.trim(),
      });
    },
    onSuccess: async (data) => {
      setErr(null);
      setForm({ ...formFromApi(data), client_secret: "" });
      await qc.invalidateQueries({ queryKey: ["settings", "oidc"] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  if (q.isLoading || !form) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">
        {q.error instanceof Error ? q.error.message : "Failed to load settings"}
      </p>
    );
  }

  const data = q.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="App settings"
        below={
          <p className="text-slate-400">
            Instance-wide options. OIDC applies to the browser admin sign-in only; automation still uses API keys.
          </p>
        }
      />

      <section className="max-w-2xl space-y-6 rounded-xl border border-border/70 bg-[#0b0f14]/50 p-6">
        <h2 className="text-lg font-medium text-white">OpenID Connect (SSO)</h2>
        <p className="text-sm text-slate-400">
          Create a dedicated admin-scoped API key to use as the OIDC proxy, then enter its numeric id below. Configure
          your IdP with the redirect URL shown here.
        </p>

        <div className="rounded-lg border border-border/60 bg-[#0b0f14] p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Suggested redirect URL</p>
          <code className="break-all font-mono text-xs text-accent">{data.suggested_callback_url}</code>
        </div>

        <p className="text-xs text-slate-500">
          Config source: <span className="text-slate-400">{data.source}</span>
          {data.oidc_login_ready ? (
            <span className="ml-2 text-emerald-400/90">SSO login is available on the sign-in page.</span>
          ) : (
            <span className="ml-2 text-slate-500">Complete the fields below to enable SSO.</span>
          )}
        </p>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => (f ? { ...f, enabled: e.target.checked } : f))}
            className="rounded border-border"
          />
          Enable OIDC sign-in
        </label>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-issuer">
            Issuer URL
          </label>
          <input
            id="oidc-issuer"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.issuer}
            onChange={(e) => setForm((f) => (f ? { ...f, issuer: e.target.value } : f))}
            autoComplete="off"
            placeholder="https://your-tenant.oidc-provider.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-client-id">
            Client ID
          </label>
          <input
            id="oidc-client-id"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.client_id}
            onChange={(e) => setForm((f) => (f ? { ...f, client_id: e.target.value } : f))}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-client-secret">
            Client secret
          </label>
          <input
            id="oidc-client-secret"
            type="password"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.client_secret}
            onChange={(e) => setForm((f) => (f ? { ...f, client_secret: e.target.value } : f))}
            autoComplete="off"
            placeholder={data.client_secret_configured ? "(unchanged — enter new value to rotate)" : ""}
          />
          {data.client_secret_configured ? (
            <p className="mt-1 text-xs text-slate-500">A secret is stored. Leave blank to keep it.</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-scopes">
            Scopes
          </label>
          <input
            id="oidc-scopes"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.scopes}
            onChange={(e) => setForm((f) => (f ? { ...f, scopes: e.target.value } : f))}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-domains">
            Allowed email domains (optional)
          </label>
          <input
            id="oidc-domains"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.allowed_email_domains}
            onChange={(e) => setForm((f) => (f ? { ...f, allowed_email_domains: e.target.value } : f))}
            autoComplete="off"
            placeholder="e.g. company.com, other.io — empty allows any IdP user (dev only)"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-post-login">
            Post-login path
          </label>
          <input
            id="oidc-post-login"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.post_login_path}
            onChange={(e) => setForm((f) => (f ? { ...f, post_login_path: e.target.value } : f))}
            autoComplete="off"
            placeholder="/projects or /app/projects when using VITE_ADMIN_BASENAME=/app"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-proxy-key">
            Proxy admin API key id
          </label>
          <input
            id="oidc-proxy-key"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.proxy_admin_key_id}
            onChange={(e) => setForm((f) => (f ? { ...f, proxy_admin_key_id: e.target.value } : f))}
            autoComplete="off"
            inputMode="numeric"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400" htmlFor="oidc-redirect-override">
            Redirect URI override (optional)
          </label>
          <input
            id="oidc-redirect-override"
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={form.redirect_uri_override}
            onChange={(e) => setForm((f) => (f ? { ...f, redirect_uri_override: e.target.value } : f))}
            autoComplete="off"
            placeholder="Only if the public URL differs from what this server sees"
          />
        </div>

        {err ? <p className="text-sm text-red-400">{err}</p> : null}

        <Button type="button" disabled={saveM.isPending} onClick={() => saveM.mutate()}>
          {saveM.isPending ? "Saving…" : "Save OIDC settings"}
        </Button>
      </section>
    </div>
  );
}
