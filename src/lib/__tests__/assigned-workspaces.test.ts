import { describe, expect, it } from "vitest";
import { filterAssignedWorkspaces, scopeToAssignments } from "@/lib/assigned-workspaces";

const catalog = [
  { id: "a", name: "VS Code Web", description: "Editor", category: "Developer", slug: "vs-code-web", status: "active" },
  { id: "b", name: "Grafana", description: "Dashboards", category: "Analytics / BI", slug: "grafana", status: "active" },
  { id: "c", name: "Retired lab", description: "Old", category: "Other", slug: "retired", status: "inactive" },
];

describe("scopeToAssignments", () => {
  it("keeps only active workspaces the learner is assigned", () => {
    expect(scopeToAssignments(catalog, ["b", "c"]).map((w) => w.id)).toEqual(["b"]);
  });

  it("drops the global catalog when the learner has no assignments", () => {
    expect(scopeToAssignments(catalog, [])).toEqual([]);
  });

  it("dedupes a workspace that appears twice", () => {
    const doubled = [catalog[0], catalog[0]];
    expect(scopeToAssignments(doubled, ["a"])).toHaveLength(1);
  });
});

describe("filterAssignedWorkspaces", () => {
  it("filters the assigned set by category and search", () => {
    const assigned = scopeToAssignments(catalog, ["a", "b"]);
    expect(filterAssignedWorkspaces(assigned, { search: "graf", category: "All" }).map((w) => w.id)).toEqual(["b"]);
    expect(filterAssignedWorkspaces(assigned, { search: "", category: "Developer" }).map((w) => w.id)).toEqual(["a"]);
  });
});
