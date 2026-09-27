import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

import { UsageSummaryPanel } from "../UsageSummaryPanel";

function chain(result: { data: unknown; error: null | { message: string } }) {
  // Every builder method returns the same thenable chain.
  const c: Record<string, unknown> = {};
  for (const m of ["select", "gte", "order", "limit", "in"]) c[m] = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

describe("UsageSummaryPanel", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("renders live usage from sessions without daily_reports", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const ended = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fromMock.mockImplementation((table: string) => {
      if (table === "sessions") {
        return chain({
          data: [{ id: "s1", user_id: "u1", lab_template_id: "t1", started_at: recent, ended_at: ended, status: "completed" }],
          error: null,
        });
      }
      if (table === "virtual_machines") return chain({ data: [{ status: "running" }], error: null });
      if (table === "lab_templates") return chain({ data: [{ id: "t1", name: "AWS Windows Lab" }], error: null });
      if (table === "profiles") return chain({ data: [{ user_id: "u1", display_name: "Asha", email: "a@x.io" }], error: null });
      return chain({ data: [], error: null });
    });

    render(<UsageSummaryPanel />);

    await waitFor(() => expect(screen.getByText("AWS Windows Lab")).toBeInTheDocument());
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("Lab usage")).toBeInTheDocument();
    expect(screen.getByText("VMs live now")).toBeInTheDocument();
    expect(screen.queryByText("daily_reports")).not.toBeInTheDocument();
  });

  it("shows a calm error when sessions cannot be read", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "sessions"
        ? chain({ data: null, error: { message: "permission denied" } })
        : chain({ data: [], error: null }),
    );
    render(<UsageSummaryPanel />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("permission denied"));
  });
});
