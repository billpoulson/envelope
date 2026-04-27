import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { approveCliDevice } from "@/api/cliDevice";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

function parseScopes(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return ["read:bundle:*"];
  return lines;
}

export default function CliDevicePage() {
  const [params] = useSearchParams();
  const initialCode = useMemo(() => (params.get("code") ?? "").trim(), [params]);
  const [userCode, setUserCode] = useState(initialCode);
  const [name, setName] = useState("CLI");
  const [scopesText, setScopesText] = useState("read:bundle:*");
  const [expiresLocal, setExpiresLocal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const scopes = parseScopes(scopesText);
      const body: Parameters<typeof approveCliDevice>[0] = {
        user_code: userCode.trim(),
        name: name.trim(),
        scopes,
      };
      if (expiresLocal.trim()) {
        const d = new Date(expiresLocal);
        if (Number.isNaN(d.getTime())) throw new Error("Invalid expiry date");
        body.expires_at = d.toISOString();
      }
      await approveCliDevice(body);
    },
    onSuccess: () => {
      setOk(true);
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Authorize CLI login"
        below={
          <p className="text-slate-400">
            Approve creation of an API key for the machine that ran{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-sm">envelope login</code>. The key is shown only
            once on the CLI after you confirm.
          </p>
        }
      />
      <div className="max-w-xl space-y-6">
        {ok ? (
          <p className="text-emerald-300/95">
            Approved. You can close this tab; return to the terminal to finish setup.
          </p>
        ) : null}
        {err ? <p className="text-sm text-red-400">{err}</p> : null}

        <label className="block space-y-2">
          <span className="text-sm text-slate-300">User code</span>
          <input
            className="w-full rounded-md border border-border/80 bg-white/5 px-3 py-2 font-mono text-white outline-none focus:border-accent"
            value={userCode}
            onChange={(e) => setUserCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="off"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm text-slate-300">Key name</span>
          <input
            className="w-full rounded-md border border-border/80 bg-white/5 px-3 py-2 text-white outline-none focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm text-slate-300">Scopes (one per line)</span>
          <textarea
            className="min-h-[120px] w-full rounded-md border border-border/80 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent"
            value={scopesText}
            onChange={(e) => setScopesText(e.target.value)}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm text-slate-300">Expires (optional, local time)</span>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-border/80 bg-white/5 px-3 py-2 text-white outline-none focus:border-accent"
            value={expiresLocal}
            onChange={(e) => setExpiresLocal(e.target.value)}
          />
        </label>

        <Button type="button" disabled={m.isPending || ok || !userCode.trim()} onClick={() => m.mutate()}>
          {m.isPending ? "Approving…" : "Approve and create key"}
        </Button>
      </div>
    </div>
  );
}
