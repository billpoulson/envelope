import type { LastAccessMetadata } from "@/api/system";

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never accessed";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

function compactUserAgent(value: string | null): string | null {
  if (!value) return null;
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

export function LastAccessSummary({ row }: { row: LastAccessMetadata }) {
  const used = Boolean(row.last_accessed_at);
  const usageName = row.last_accessed_usage_name;
  const usageKind = row.last_accessed_usage_kind;
  const usageRun = row.last_accessed_usage_run;
  const userAgent = compactUserAgent(row.last_accessed_user_agent);

  if (!used) {
    return <span className="text-xs text-slate-500">Never accessed</span>;
  }

  return (
    <div className="space-y-1 text-xs text-slate-400">
      <div title={row.last_accessed_at ?? undefined}>{formatDateTime(row.last_accessed_at)}</div>
      {usageName || usageKind || usageRun ? (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {usageName ? <span className="text-slate-300">{usageName}</span> : null}
          {usageKind ? <span>{usageKind}</span> : null}
          {usageRun ? (
            isHttpUrl(usageRun) ? (
              <a className="text-accent hover:underline" href={usageRun} target="_blank" rel="noreferrer">
                run
              </a>
            ) : (
              <span>{usageRun}</span>
            )
          ) : null}
        </div>
      ) : null}
      {row.last_accessed_ip || userAgent ? (
        <div className="text-slate-500">
          {row.last_accessed_ip ? <span>{row.last_accessed_ip}</span> : null}
          {row.last_accessed_ip && userAgent ? <span> · </span> : null}
          {userAgent ? <span title={row.last_accessed_user_agent ?? undefined}>{userAgent}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function formatAuditDateTime(iso: string | null): string {
  return formatDateTime(iso);
}

export function renderUsageRun(value: string | undefined) {
  if (!value) return null;
  if (isHttpUrl(value)) {
    return (
      <a className="text-accent hover:underline" href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  return value;
}
