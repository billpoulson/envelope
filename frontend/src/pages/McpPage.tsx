import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  approveMcpApproval,
  denyMcpApproval,
  getMcpStatus,
  listMcpApprovals,
  type McpApproval,
} from "@/api/mcp";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card } from "@/components/ui";

function absoluteEndpoint(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusClass(status: McpApproval["status"]): string {
  if (status === "pending") return "text-amber-200";
  if (status === "executed") return "text-green-300";
  if (status === "failed") return "text-red-300";
  return "text-slate-300";
}

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
  busy,
}: {
  approval: McpApproval;
  onApprove: (id: number, note: string) => void;
  onDeny: (id: number, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Card className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">#{approval.id}</div>
          <h3 className="text-base font-medium text-white">{approval.tool_name}</h3>
          <p className="text-sm text-slate-400">
            {approval.resource_type ?? "resource"} {approval.resource_name ? `- ${approval.resource_name}` : ""}
            {approval.project_slug ? ` in ${approval.project_slug}` : ""}
            {approval.environment_slug ? `@${approval.environment_slug}` : ""}
          </p>
        </div>
        <div className={`font-mono text-xs uppercase tracking-wide ${statusClass(approval.status)}`}>
          {approval.status}
        </div>
      </div>

      <div className="grid gap-3 text-sm text-slate-400 md:grid-cols-3">
        <div>
          <div className="text-slate-500">Requested</div>
          <div>{fmt(approval.created_at)}</div>
        </div>
        <div>
          <div className="text-slate-500">Requester</div>
          <div>{approval.requester_api_key_name ?? approval.requester_api_key_id ?? "-"}</div>
        </div>
        <div>
          <div className="text-slate-500">Decision</div>
          <div>{approval.decision_admin_api_key_name ?? "-"}</div>
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-sm text-accent">Sanitized arguments</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-3 text-xs text-slate-300">
          {JSON.stringify(approval.arguments, null, 2)}
        </pre>
      </details>

      {approval.error ? <p className="text-sm text-red-300">{approval.error}</p> : null}

      {approval.status === "pending" ? (
        <div className="space-y-3">
          <textarea
            className="min-h-20 w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
            placeholder="Optional decision note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => onApprove(approval.id, note)}>
              Approve and run
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onDeny(approval.id, note)}>
              Deny
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function McpPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<McpApproval["status"] | undefined>("pending");
  const statusQ = useQuery({ queryKey: ["mcp", "status"], queryFn: getMcpStatus });
  const approvalsQ = useQuery({
    queryKey: ["mcp", "approvals", filter ?? "all"],
    queryFn: () => listMcpApprovals(filter),
  });
  const refreshApprovals = () => qc.invalidateQueries({ queryKey: ["mcp", "approvals"] });
  const approveM = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => approveMcpApproval(id, note),
    onSuccess: refreshApprovals,
  });
  const denyM = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => denyMcpApproval(id, note),
    onSuccess: refreshApprovals,
  });

  const endpoint = absoluteEndpoint(statusQ.data?.endpoint_path ?? "/mcp");
  const configExample = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            envelope: {
              type: "streamable-http",
              url: endpoint,
              headers: { Authorization: "Bearer <envelope-api-key>" },
            },
          },
        },
        null,
        2,
      ),
    [endpoint],
  );

  const approvals = approvalsQ.data?.approvals ?? [];
  const busy = approveM.isPending || denyM.isPending;

  return (
    <div className="space-y-8">
      <PageHeader
        title="MCP"
        below={
          <p className="max-w-3xl text-slate-400">
            Expose Envelope to MCP-capable AI clients. Reads use API-key scopes immediately; writes create approval
            requests that admins review here before Envelope changes anything.
          </p>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-lg text-white">Endpoint</h2>
          <p className="text-sm text-slate-400">
            Status:{" "}
            <span className={statusQ.data?.enabled ? "text-green-300" : "text-amber-200"}>
              {statusQ.data?.enabled ? "Enabled" : "Disabled"}
            </span>
          </p>
          <div className="rounded-lg border border-border bg-[#0b0f14] p-3 font-mono text-sm text-slate-300">
            {endpoint}
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-3 text-xs text-slate-300">
            {configExample}
          </pre>
        </Card>

        <Card>
          <h2 className="mb-3 text-lg text-white">Tools</h2>
          {statusQ.isLoading ? <p className="text-slate-400">Loading tools...</p> : null}
          {statusQ.isError ? <p className="text-red-400">Failed to load MCP status.</p> : null}
          <div className="max-h-96 space-y-2 overflow-auto">
            {(statusQ.data?.tools ?? []).map((tool) => (
              <div key={tool.name} className="rounded-lg border border-border/60 bg-[#0b0f14]/60 p-3">
                <div className="font-mono text-sm text-slate-200">{tool.name}</div>
                <div className="text-sm text-slate-500">{tool.description}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg text-white">Approval Queue</h2>
          <div className="flex flex-wrap gap-2">
            {(["pending", "executed", "denied", "failed"] as const).map((s) => (
              <Button
                key={s}
                type="button"
                variant={filter === s ? "primary" : "secondary"}
                onClick={() => setFilter(s)}
              >
                {s}
              </Button>
            ))}
            <Button type="button" variant={filter === undefined ? "primary" : "secondary"} onClick={() => setFilter(undefined)}>
              all
            </Button>
            <Button type="button" variant="secondary" onClick={() => void refreshApprovals()}>
              Refresh
            </Button>
          </div>
        </div>

        {approvalsQ.isLoading ? <p className="text-slate-400">Loading approvals...</p> : null}
        {approvalsQ.isError ? <p className="text-red-400">Failed to load MCP approvals.</p> : null}
        {!approvalsQ.isLoading && approvals.length === 0 ? (
          <p className="text-slate-400">No MCP approval requests found.</p>
        ) : null}
        <div className="space-y-4">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              busy={busy}
              onApprove={(id, note) => approveM.mutate({ id, note })}
              onDeny={(id, note) => denyM.mutate({ id, note })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
