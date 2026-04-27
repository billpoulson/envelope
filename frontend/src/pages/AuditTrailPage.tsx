import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listAuditEvents, type AuditEventRow } from "@/api/system";
import { formatAuditDateTime, renderUsageRun } from "@/components/LastAccessSummary";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

const PAGE_SIZE = 50;

function resourceLabel(ev: AuditEventRow): string {
  if (ev.bundle_name) return `Bundle: ${ev.bundle_name}`;
  if (ev.stack_name) return `Stack: ${ev.stack_name}`;
  return "System";
}

function actorLabel(ev: AuditEventRow): string {
  if (ev.actor_api_key_name) return ev.actor_api_key_name;
  if (ev.token_sha256_prefix) return `Secret URL ${ev.token_sha256_prefix}`;
  return "-";
}

function compact(value: string | null, max = 88): string {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function searchableText(ev: AuditEventRow): string {
  return [
    ev.event_type,
    ev.actor_api_key_name,
    ev.bundle_name,
    ev.stack_name,
    ev.token_sha256_prefix,
    ev.client_ip,
    ev.user_agent,
    ev.path,
    ev.details?.usage?.name,
    ev.details?.usage?.kind,
    ev.details?.usage?.run,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function DetailsJson({ ev }: { ev: AuditEventRow }) {
  const details = {
    method: ev.http_method,
    path: ev.path,
    bundle_env_link_id: ev.bundle_env_link_id,
    stack_env_link_id: ev.stack_env_link_id,
    token_sha256_prefix: ev.token_sha256_prefix,
    details: ev.details,
  };
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-3 text-xs text-slate-300">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

export default function AuditTrailPage() {
  const qc = useQueryClient();
  const [pages, setPages] = useState<number[]>([]);
  const [filter, setFilter] = useState("");
  const beforeId = pages.length ? pages[pages.length - 1] : undefined;
  const q = useQuery({
    queryKey: ["audit-events", beforeId ?? "latest"],
    queryFn: () => listAuditEvents({ limit: PAGE_SIZE, beforeId }),
  });

  const events = q.data?.events ?? [];
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return events;
    return events.filter((ev) => searchableText(ev).includes(f));
  }, [events, filter]);
  const lastId = events.length ? events[events.length - 1]?.id : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        below={
          <p className="max-w-3xl text-slate-400">
            Browse sensitive access events, including API-key exports and opaque Secret URL downloads. Usage fields come
            from optional <code className="font-mono text-slate-300">X-Envelope-Usage-*</code> headers.
          </p>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-[#0b0f14]/60 p-4 sm:flex-row sm:items-end sm:justify-between">
        <label className="block flex-1 text-sm text-slate-400">
          Filter loaded events
          <input
            className="mt-1 w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
            placeholder="event, actor, resource, usage, IP..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void qc.invalidateQueries({ queryKey: ["audit-events"] })}
        >
          Refresh
        </Button>
      </div>

      {q.isLoading ? <p className="text-slate-400">Loading audit events...</p> : null}
      {q.isError ? (
        <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed to load audit events"}</p>
      ) : null}
      {!q.isLoading && !q.isError && events.length === 0 ? (
        <p className="text-slate-400">No audit events found.</p>
      ) : null}

      {events.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/80 bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Resource</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => {
                const usage = ev.details?.usage;
                return (
                  <tr key={ev.id} className="align-top border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 text-xs text-slate-400" title={ev.created_at}>
                      {formatAuditDateTime(ev.created_at)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{ev.event_type}</td>
                    <td className="px-4 py-3 text-slate-300">{resourceLabel(ev)}</td>
                    <td className="px-4 py-3 text-slate-400">{actorLabel(ev)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {usage ? (
                        <div className="space-y-1">
                          <div className="text-slate-300">{usage.name ?? "-"}</div>
                          <div>{usage.kind ?? "-"}</div>
                          <div className="break-all">{renderUsageRun(usage.run)}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <div>{ev.client_ip ?? "-"}</div>
                      <div title={ev.user_agent ?? undefined}>{compact(ev.user_agent)}</div>
                      <details>
                        <summary className="mt-2 cursor-pointer text-accent">Details</summary>
                        <DetailsJson ev={ev} />
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex gap-2">
        {pages.length > 0 ? (
          <Button type="button" variant="secondary" onClick={() => setPages((xs) => xs.slice(0, -1))}>
            Newer
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={q.isLoading || events.length < PAGE_SIZE || lastId === undefined}
          onClick={() => {
            if (lastId !== undefined) setPages((xs) => [...xs, lastId]);
          }}
        >
          Load older
        </Button>
      </div>
    </div>
  );
}
