/** Short operator checklist for the Security audit trail help page. */

import { Link } from "react-router-dom";

export function AuditTrailConfigureTutorial() {
  return (
    <div className="not-prose mt-8 space-y-6 border-t border-border/60 pt-8">
      <h3 className="text-lg font-semibold text-slate-100">Configuration checklist</h3>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">1. Enable sinks</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          Defaults: <strong className="text-slate-300">both</strong> JSON logs and database rows are on. Set{" "}
          <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">ENVELOPE_AUDIT_LOG_ENABLED</code>{" "}
          or{" "}
          <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">
            ENVELOPE_AUDIT_DATABASE_ENABLED
          </code>{" "}
          to <code className="font-mono text-xs text-slate-300">false</code> only if you rely entirely on the other
          sink.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">2. Ship logs</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          Forward process/container logs to your aggregator and parse lines from logger{" "}
          <strong className="text-slate-300">envelope.audit</strong> (one JSON object per line). Apply your org’s
          retention and access controls in the SIEM—not in Envelope.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">3. Trust the proxy (optional)</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          Set <strong className="text-slate-300">FORWARDED_ALLOW_IPS</strong> so Uvicorn honors{" "}
          <code className="font-mono text-xs text-slate-300">X-Forwarded-For</code> from your gateway; keep gateway
          access logs for defense in depth. See{" "}
          <Link to="/help/installation" className="text-accent hover:underline">
            Installation &amp; hosting
          </Link>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">4. Query events</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          Use <code className="font-mono text-xs text-slate-300">GET /api/v1/system/audit-events</code> with an{" "}
          <strong className="text-slate-300">admin</strong> API key (<code className="font-mono text-xs text-slate-300">
            limit
          </code>
          , <code className="font-mono text-xs text-slate-300">before_id</code>). Open{" "}
          <code className="font-mono text-xs text-slate-300">/docs</code> on your server for the full schema.
        </p>
      </section>
    </div>
  );
}
