import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StackLayersEditor } from "@/components/StackLayersEditor";

vi.mock("@/api/bundles", () => ({
  listBundleKeyNames: vi.fn(() => Promise.resolve(["alpha", "beta"])),
}));

import { listBundleKeyNames } from "@/api/bundles";

describe("StackLayersEditor", () => {
  beforeEach(() => {
    vi.mocked(listBundleKeyNames).mockClear();
  });

  it("passes bundleKeyScope to listBundleKeyNames for pick-mode key loading", async () => {
    const scope = { projectSlug: "acme", environmentSlug: "production" };
    render(
      <MemoryRouter>
        <StackLayersEditor
          bundleNames={["b1"]}
          bundleKeyScope={scope}
          projectSlug="acme"
          stackEnvironmentSlug="production"
          layers={[
            { bundle: "b1", mode: "pick", selected: [], label: "", aliasRows: [] },
          ]}
          onChange={() => {}}
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(listBundleKeyNames).toHaveBeenCalledWith("b1", scope);
    });
  });
});
