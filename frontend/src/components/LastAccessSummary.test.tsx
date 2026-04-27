import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LastAccessSummary } from "@/components/LastAccessSummary";

describe("LastAccessSummary", () => {
  it("shows never accessed when no timestamp exists", () => {
    render(
      <LastAccessSummary
        row={{
          last_accessed_at: null,
          last_accessed_usage_name: null,
          last_accessed_usage_kind: null,
          last_accessed_usage_run: null,
          last_accessed_ip: null,
          last_accessed_user_agent: null,
        }}
      />,
    );

    expect(screen.getByText("Never accessed")).toBeInTheDocument();
  });

  it("renders usage and source metadata with linked run URLs", () => {
    render(
      <LastAccessSummary
        row={{
          last_accessed_at: "2026-04-26T14:00:00Z",
          last_accessed_usage_name: "Pulumi Infra",
          last_accessed_usage_kind: "github-action",
          last_accessed_usage_run: "https://github.com/billpoulson/yacht.ai/actions/runs/123",
          last_accessed_ip: "127.0.0.1",
          last_accessed_user_agent: "vitest-agent",
        }}
      />,
    );

    expect(screen.getByText("Pulumi Infra")).toBeInTheDocument();
    expect(screen.getByText("github-action")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "run" })).toHaveAttribute(
      "href",
      "https://github.com/billpoulson/yacht.ai/actions/runs/123",
    );
    expect(screen.getByText(/127\.0\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText(/vitest-agent/)).toBeInTheDocument();
  });
});
