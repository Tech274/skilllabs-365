import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { fromMock, rpcMock, assignmentRows, learner } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  assignmentRows: {
    current: [] as Array<{ workspace_id: string; platform_applications: Record<string, unknown> }>,
  },
  learner: { id: "learner-1", email: "learner@example.com" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: learner }),
}));

vi.mock("@/hooks/use-workspace-affinity", () => ({
  useWorkspaceAffinity: () => ({
    favorites: new Set<string>(),
    recentOrder: [] as string[],
    toggleFavorite: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/WorkspaceCredentialActivity", () => ({
  WorkspaceCredentialActivity: () => null,
}));

vi.mock("@/components/WorkspaceLauncher", () => ({
  useWorkspaceEmailDomain: () => "example.com",
  useWorkspaceLauncher: () => ({ open: vi.fn(), dialog: null }),
  WorkspaceTile: ({ workspace }: { workspace: { name: string } }) => <article>{workspace.name}</article>,
}));

import Applications from "../Applications";

const grafana = {
  id: "graf",
  name: "Grafana",
  description: "Dashboards",
  category: "Analytics / BI",
  slug: "grafana",
  status: "active",
};

const vscode = {
  id: "vscode",
  name: "VS Code Web",
  description: "Editor",
  category: "Developer",
  slug: "vs-code-web",
  status: "active",
};

/** Mimics the Postgrest filter builder, which is awaitable after .is(). */
function assignmentQuery() {
  const result = () => Promise.resolve({ data: assignmentRows.current, error: null });
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    result().then(resolve, reject);
  return builder;
}

describe("Applications learner list", () => {
  beforeEach(() => {
    assignmentRows.current = [];
    fromMock.mockReset();
    rpcMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      if (table !== "workspace_assignments") {
        throw new Error(`unexpected table ${table}`);
      }
      return assignmentQuery();
    });
    rpcMock.mockResolvedValue({
      data: [
        { workspace: grafana, total_count: 2 },
        { workspace: vscode, total_count: 2 },
      ],
      error: null,
    });
  });

  it("shows only workspaces assigned to the learner", async () => {
    assignmentRows.current = [{ workspace_id: "graf", platform_applications: grafana }];

    render(<Applications />);

    expect(await screen.findByText("Grafana")).toBeInTheDocument();
    expect(screen.queryByText("VS Code Web")).not.toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("workspace_assignments");
  });

  it("drops catalog rows that search_workspaces returns outside the assignment", async () => {
    assignmentRows.current = [{ workspace_id: "graf", platform_applications: grafana }];

    render(<Applications />);
    expect(await screen.findByText("Grafana")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search workspaces"), { target: { value: "code" } });

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(screen.getByText("Grafana")).toBeInTheDocument();
    expect(screen.queryByText("VS Code Web")).not.toBeInTheDocument();
  });

  it("shows the empty assignment state when nothing is assigned", async () => {
    assignmentRows.current = [];

    render(<Applications />);

    expect(await screen.findByText("No workspaces found")).toBeInTheDocument();
    expect(screen.getByText(/No workspaces are assigned to you yet/)).toBeInTheDocument();
    expect(screen.queryByText("Grafana")).not.toBeInTheDocument();
    expect(screen.queryByText("VS Code Web")).not.toBeInTheDocument();
  });
});
