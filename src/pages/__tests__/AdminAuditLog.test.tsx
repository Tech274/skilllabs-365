import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const limit = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit,
        }),
      }),
    }),
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminAuditLog from "../AdminAuditLog";

const OUTCOMES = [
  { outcome: "already_running", label: "Already running", className: "text-sky-400" },
  { outcome: "already_starting", label: "Already starting", className: "text-violet-400" },
  { outcome: "start_accepted", label: "Start accepted", className: "text-blue-400" },
  { outcome: "running", label: "Running", className: "text-emerald-300" },
  { outcome: "failed", label: "Failed", className: "text-destructive" },
] as const;

describe("AdminAuditLog override outcome badges", () => {
  beforeEach(() => {
    limit.mockReset();
  });

  it("labels admin Start override outcomes instead of the raw value", async () => {
    limit.mockResolvedValue({
      data: OUTCOMES.map((row, i) => ({
        id: `row-${i}`,
        created_at: "2026-09-28T03:00:00.000Z",
        actor_email: "ops@example.com",
        actor_type: "user",
        action: "vm.admin_start_override",
        entity_type: "virtual_machine",
        entity_label: "vm-1",
        outcome: row.outcome,
        message: null,
        correlation_id: null,
        changes: { restart_outcome: row.outcome },
      })),
      error: null,
    });

    render(<AdminAuditLog />);

    for (const row of OUTCOMES) {
      const badge = await screen.findByText(row.label);
      expect(badge.className).toContain(row.className);
      expect(screen.queryByText(row.outcome)).not.toBeInTheDocument();
    }
  });

  it("keeps an unmapped outcome visible as its raw value", async () => {
    limit.mockResolvedValue({
      data: [{
        id: "row-unknown",
        created_at: "2026-09-28T03:00:00.000Z",
        actor_email: null,
        actor_type: "system",
        action: "vm.admin_start_override",
        entity_type: "virtual_machine",
        entity_label: null,
        outcome: "mystery_outcome",
        message: null,
        correlation_id: null,
        changes: {},
      }],
      error: null,
    });

    render(<AdminAuditLog />);

    const badge = await waitFor(() => screen.getByText("mystery_outcome"));
    expect(badge.className).not.toContain("text-sky-400");
    expect(badge.className).not.toContain("text-violet-400");
  });
});
