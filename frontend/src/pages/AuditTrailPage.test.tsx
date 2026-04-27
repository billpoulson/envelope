import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuditTrailPage from "@/pages/AuditTrailPage";

vi.mock("@/api/system", () => ({
  listAuditEvents: vi.fn(() =>
    Promise.resolve({
      events: [
        {
          id: 10,
          created_at: "2026-04-26T14:00:00Z",
          event_type: "env_link.download",
          actor_api_key_id: null,
          actor_api_key_name: null,
          bundle_id: 1,
          bundle_name: "infra",
          stack_id: null,
          stack_name: null,
          bundle_env_link_id: 7,
          stack_env_link_id: null,
          token_sha256_prefix: "abc12345",
          client_ip: "127.0.0.1",
          user_agent: "vitest-agent",
          http_method: "GET",
          path: "/env/token",
          details: {
            format: "json",
            usage: {
              name: "Pulumi Infra",
              kind: "github-action",
              run: "https://github.com/billpoulson/yacht.ai/actions/runs/123",
            },
          },
        },
      ],
    }),
  ),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuditTrailPage />
    </QueryClientProvider>,
  );
}

describe("AuditTrailPage", () => {
  it("renders audit usage, resource, actor, and source metadata", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("env_link.download")).toBeInTheDocument());
    expect(screen.getByText("Bundle: infra")).toBeInTheDocument();
    expect(screen.getByText("Secret URL abc12345")).toBeInTheDocument();
    expect(screen.getByText("Pulumi Infra")).toBeInTheDocument();
    expect(screen.getByText("github-action")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github\.com\/billpoulson\/yacht\.ai/ })).toHaveAttribute(
      "href",
      "https://github.com/billpoulson/yacht.ai/actions/runs/123",
    );
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("vitest-agent")).toBeInTheDocument();
  });
});
