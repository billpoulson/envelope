import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import McpPage from "@/pages/McpPage";
import { approveMcpApproval } from "@/api/mcp";

vi.mock("@/api/mcp", () => ({
  getMcpStatus: vi.fn(() =>
    Promise.resolve({
      enabled: true,
      endpoint_path: "/mcp",
      transport: "streamable-http",
      protocol_version: "2025-03-26",
      tools: [{ name: "list_projects", description: "List projects", inputSchema: {} }],
    }),
  ),
  listMcpApprovals: vi.fn(() =>
    Promise.resolve({
      approvals: [
        {
          id: 42,
          created_at: "2026-04-27T01:00:00Z",
          updated_at: "2026-04-27T01:00:00Z",
          status: "pending",
          tool_name: "request_create_bundle",
          arguments: { name: "demo", entries: "[redacted]" },
          requester_api_key_id: 1,
          requester_api_key_name: "agent",
          resource_type: "bundle",
          resource_name: "demo",
          project_slug: "prod",
          environment_slug: "default",
          decision_admin_api_key_id: null,
          decision_admin_api_key_name: null,
          decided_at: null,
          decision_note: null,
          result: {},
          error: null,
        },
      ],
    }),
  ),
  approveMcpApproval: vi.fn(() =>
    Promise.resolve({
      id: 42,
      status: "executed",
      arguments: {},
      result: {},
    }),
  ),
  denyMcpApproval: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <McpPage />
    </QueryClientProvider>,
  );
}

describe("McpPage", () => {
  it("renders endpoint, tools, sanitized approval, and approval action", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("request_create_bundle")).toBeInTheDocument());
    expect(screen.getByText(/streamable-http/)).toBeInTheDocument();
    expect(screen.getByText("list_projects")).toBeInTheDocument();
    expect(screen.getByText(/agent/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /approve and run/i }));
    await waitFor(() => expect(approveMcpApproval).toHaveBeenCalledWith(42, ""));
  });
});
