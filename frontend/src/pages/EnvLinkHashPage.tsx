import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resolveEnvLinkByDigest } from "@/api/envLinks";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { envLinksPageLocation } from "@/util/envLinksNavigate";
import { parseDigestOnlyInput, parseEnvLinkInput, sha256HexUtf8 } from "@/util/envLinkHash";

export default function EnvLinkHashPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [digestMode, setDigestMode] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [hashHex, setHashHex] = useState<string | null>(null);
  const [cryptoErr, setCryptoErr] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);

  useEffect(() => {
    setCryptoErr(null);
    setHashHex(null);
    setDigestMode(false);
    setResolveErr(null);
    if (!input.trim()) {
      setToken(null);
      setParseErr(null);
      return;
    }

    const pastedDigest = parseDigestOnlyInput(input);
    if (pastedDigest) {
      setDigestMode(true);
      setToken(null);
      setParseErr(null);
      setHashHex(pastedDigest);
      return;
    }

    const parsed = parseEnvLinkInput(input);
    if ("error" in parsed) {
      setToken(null);
      setParseErr(parsed.error);
      return;
    }
    setParseErr(null);
    setToken(parsed.token);

    if (!globalThis.crypto?.subtle) {
      setCryptoErr("SHA-256 requires a secure context (HTTPS or localhost).");
      return;
    }

    let cancelled = false;
    void sha256HexUtf8(parsed.token).then(
      (hex) => {
        if (!cancelled) setHashHex(hex);
      },
      () => {
        if (!cancelled) setCryptoErr("Could not compute SHA-256.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input]);

  async function goToResource() {
    if (!hashHex) return;
    setResolveErr(null);
    setResolveBusy(true);
    try {
      const res = await resolveEnvLinkByDigest(hashHex);
      const loc = envLinksPageLocation(res, { highlightSha256: hashHex });
      navigate({ pathname: loc.pathname, search: loc.search });
    } catch (e: unknown) {
      setResolveErr(formatApiError(e));
    } finally {
      setResolveBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Env link hash"
        below={
          <p className="text-slate-400">
            Compute <code className="text-slate-300">token_sha256</code> locally from a URL or path token (nothing sent
            to the server), or paste a stored <code className="text-slate-300">token_sha256</code> from the list to open
            the matching bundle or stack <strong className="text-slate-300">Secret env URL</strong> page (requires
            login and write access to that resource).
          </p>
        }
      />

      <section className="space-y-3">
        <label htmlFor="env-link-hash-input" className="block text-sm font-medium text-slate-300">
          URL, path token, or token_sha256
        </label>
        <textarea
          id="env-link-hash-input"
          rows={3}
          className="w-full max-w-3xl rounded-lg border border-border/80 bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="https://your-host/env/… — or token only — or 64-char hex digest"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </section>

      {parseErr ? <p className="text-sm text-amber-200/90">{parseErr}</p> : null}
      {cryptoErr ? <p className="text-sm text-red-400">{cryptoErr}</p> : null}
      {resolveErr ? <p className="text-sm text-red-400">{resolveErr}</p> : null}

      {digestMode && hashHex ? (
        <p className="text-xs text-slate-500">
          Detected a stored <span className="font-mono text-slate-400">token_sha256</span> (64 hex digits), not a raw
          download path.
        </p>
      ) : null}

      {token && !parseErr && !digestMode ? (
        <section className="space-y-2 rounded-xl border border-border/60 bg-[#0b0f14]/80 p-4">
          <h2 className="text-sm font-medium text-slate-300">Path token (UTF-8 input to SHA-256)</h2>
          <code className="block break-all font-mono text-sm text-slate-200">{token}</code>
        </section>
      ) : null}

      {hashHex ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-300">token_sha256 (compare to list API / UI)</h2>
          <code className="block max-w-3xl break-all font-mono text-sm text-accent">{hashHex}</code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={resolveBusy}
              onClick={() => void goToResource()}
            >
              {resolveBusy ? "Opening…" : "Open Secret env URL page"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(hashHex)}
            >
              Copy hash
            </Button>
            {token ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(token)}
              >
                Copy token
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="max-w-2xl text-xs text-slate-500">
        Revoke with{" "}
        <code className="text-slate-400">DELETE /api/v1/bundles/…/env-links/{'{id}'}</code> or the stack
        equivalent when this hash matches a listed row. Resolve uses{" "}
        <code className="text-slate-400">GET /api/v1/env-links/resolve?token_sha256=…</code>.{" "}
        <Link to="/help/api" className="text-accent hover:underline">
          Help → API export
        </Link>
      </p>
    </div>
  );
}
