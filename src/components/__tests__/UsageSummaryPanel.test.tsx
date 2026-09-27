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
  for (const m of ["select", "gte", "order", "limit", "in", "range", "eq"]) c[m] = () => c;
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

  it("pages sessions past the 1000-row cap, chunks learner lookups and counts VMs exactly", async () => {
    const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ended = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const all = Array.from({ length: 1500 }, (_, i) => ({
      id: `s${i}`, user_id: `u${i % 250}`, lab_template_id: "t1", started_at: started, ended_at: ended, status: "completed",
    }));
    const profileChunks: number[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "sessions") {
        let range: [number, number] = [0, 999];
        const c: Record<string, unknown> = {};
        for (const m of ["select", "gte", "order"]) c[m] = () => c;
        c.range = (a: number, b: number) => { range = [a, Math.min(b, a + 999)]; return c; };
        c.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: all.slice(range[0], range[1] + 1), error: null }).then(resolve);
        return c;
      }
      if (table === "profiles") {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "order", "range"]) c[m] = () => c;
        c.in = (_col: string, ids: string[]) => { profileChunks.push(ids.length); return c; };
        c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
        return c;
      }
      if (table === "virtual_machines") {
        let status = "";
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = (_col: string, v: string) => { status = v; return c; };
        c.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, count: status === "running" ? 1200 : 0, error: null }).then(resolve);
        return c;
      }
      return chain({ data: [{ id: "t1", name: "AWS Windows Lab" }], error: null });
    });

    render(<UsageSummaryPanel />);
    await waitFor(() => expect(screen.getAllByText("1500").length).toBeGreaterThan(0));
    expect(screen.getAllByText("1200").length).toBeGreaterThan(0); // VMs live now: exact count, not a 1000-row sample
    expect(Math.max(...profileChunks)).toBeLessThanOrEqual(100);
    expect(profileChunks.reduce((a, b) => a + b, 0)).toBe(250);
  });
});
