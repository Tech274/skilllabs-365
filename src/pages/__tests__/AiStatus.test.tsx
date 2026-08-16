import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const logsResult = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => logsResult(),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/AiHealthChart", () => ({ AiHealthChart: () => <div /> }));
vi.mock("@/components/AiQuotaManager", () => ({ AiQuotaManager: () => <div /> }));
vi.mock("@/components/AiAlertDeliveries", () => ({ AiAlertDeliveries: () => <div /> }));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import AiStatus from "../AiStatus";

describe("AiStatus failure rendering", () => {
  beforeEach(() => {
    invoke.mockReset();
    logsResult.mockReset();
  });

  it("renders an outage status with the provider message", async () => {
    invoke.mockResolvedValue({
      data: {
        status: "unreachable",
        model: "google/gemini-3.6-flash",
        missing_env: [],
        latency_ms: 4210,
        checked_at: new Date().toISOString(),
        message: "AI provider unreachable",
      },
      error: null,
    });
    logsResult.mockResolvedValue({ data: [], error: null });

    render(<AiStatus />);

    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
    expect(screen.getByText("AI provider unreachable")).toBeInTheDocument();
    expect(screen.getByText("4210 ms")).toBeInTheDocument();
  });

  it("surfaces missing configuration when the provider is misconfigured", async () => {
    invoke.mockResolvedValue({
      data: {
        status: "misconfigured",
        model: "google/gemini-3.6-flash",
        missing_env: ["LOVABLE_API_KEY"],
        latency_ms: null,
        checked_at: new Date().toISOString(),
        message: "Missing configuration: LOVABLE_API_KEY",
      },
      error: null,
    });
    logsResult.mockResolvedValue({ data: [], error: null });

    render(<AiStatus />);

    await waitFor(() => expect(screen.getByText("Misconfigured")).toBeInTheDocument());
    expect(screen.getAllByText(/Missing configuration: LOVABLE_API_KEY/).length).toBeGreaterThan(0);
  });

  it("lists recent failed AI requests with error metadata", async () => {
    invoke.mockResolvedValue({
      data: {
        status: "degraded",
        model: "google/gemini-3.6-flash",
        missing_env: [],
        latency_ms: 9000,
        checked_at: new Date().toISOString(),
        message: "AI provider returned 503",
      },
      error: null,
    });
    logsResult.mockResolvedValue({
      data: [
        {
          id: "1",
          function_name: "ai-chat",
          request_id: "abcdef12-3456",
          model: "google/gemini-3.6-flash",
          latency_ms: 120,
          status: "error",
          http_status: 503,
          error_type: "gateway_error",
          error_message: "AI gateway unavailable",
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    render(<AiStatus />);

    await waitFor(() => expect(screen.getByText("ai-chat")).toBeInTheDocument());
    expect(screen.getByText("error 503")).toBeInTheDocument();
    expect(screen.getByText("AI gateway unavailable")).toBeInTheDocument();
    // failure counter on the health card
    expect(screen.getByText("Failures (last 50 calls)")).toBeInTheDocument();
  });

  it("keeps rendering when the health check itself fails", async () => {
    invoke.mockRejectedValue(new Error("Edge function returned 500"));
    logsResult.mockResolvedValue({ data: [], error: null });

    render(<AiStatus />);

    await waitFor(() => expect(screen.getByText("AI Status")).toBeInTheDocument());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
