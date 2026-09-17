import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

import AdminCloudQuotas from "../AdminCloudQuotas";

describe("AdminCloudQuotas", () => {
  beforeEach(() => {
    invoke.mockReset();
    fromMock.mockReset();
    fromMock.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    });
  });

  it("renders provider switch and Central India home copy", async () => {
    invoke.mockResolvedValue({
      data: {
        home: { azure: "centralindia", aws: "ap-south-1" },
        providers: {
          azure: {
            provider: "azure",
            last_status: "never",
            last_reason: "Not synced yet",
            last_ok_at: null,
            last_fail_at: null,
            last_synced_at: null,
            home_region: "centralindia",
            snapshot: {},
          },
          aws: {
            provider: "aws",
            last_status: "not_connected",
            last_reason: "AWS Service Quotas API not wired in Hub v1",
            last_ok_at: null,
            last_fail_at: null,
            last_synced_at: null,
            home_region: "ap-south-1",
            snapshot: { mode: "stub" },
          },
        },
      },
      error: null,
    });

    render(<AdminCloudQuotas />);

    await waitFor(() => expect(screen.getByText("Cloud Quotas")).toBeInTheDocument());
    expect(screen.getByText(/not southindia/i)).toBeInTheDocument();
    expect(screen.getByText("AZURE sync health")).toBeInTheDocument();
    expect(screen.getByText("AWS sync health")).toBeInTheDocument();
    expect(screen.getByText(/Not connected/i)).toBeInTheDocument();
  });
});
