import { fetchCsrf } from "./auth";
import { apiFetch, getCsrfHeader } from "./client";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type McpStatus = {
  enabled: boolean;
  endpoint_path: string;
  transport: string;
  protocol_version: string;
  tools: McpToolDefinition[];
};

export type McpApproval = {
  id: number;
  created_at: string | null;
  updated_at: string | null;
  status: "pending" | "denied" | "executed" | "failed";
  tool_name: string;
  arguments: Record<string, unknown>;
  requester_api_key_id: number | null;
  requester_api_key_name: string | null;
  resource_type: string | null;
  resource_name: string | null;
  project_slug: string | null;
  environment_slug: string | null;
  decision_admin_api_key_id: number | null;
  decision_admin_api_key_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result: Record<string, unknown>;
  error: string | null;
};

export type McpApprovalsResponse = {
  approvals: McpApproval[];
};

export async function getMcpStatus(): Promise<McpStatus> {
  return apiFetch<McpStatus>("/mcp/status", { method: "GET" });
}

export async function listMcpApprovals(status?: McpApproval["status"]): Promise<McpApprovalsResponse> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", "100");
  return apiFetch<McpApprovalsResponse>(`/mcp/approvals?${q.toString()}`, { method: "GET" });
}

export async function approveMcpApproval(id: number, note?: string): Promise<McpApproval> {
  const csrf = await fetchCsrf();
  return apiFetch<McpApproval>(`/mcp/approvals/${id}/approve`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: { note: note?.trim() || null },
  });
}

export async function denyMcpApproval(id: number, note?: string): Promise<McpApproval> {
  const csrf = await fetchCsrf();
  return apiFetch<McpApproval>(`/mcp/approvals/${id}/deny`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: { note: note?.trim() || null },
  });
}
