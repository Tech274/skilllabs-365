/**
 * Learner workspace visibility.
 *
 * `search_workspaces` returns every active catalog row the caller can read.
 * Platform admins can read the whole catalog, so the learner page must
 * intersect that result with the current user's active `workspace_assignments`.
 */

export function scopeToAssignments<T extends { id: string; status: string }>(
  workspaces: T[],
  assignmentWorkspaceIds: Iterable<string>,
): T[] {
  const allowed = new Set(assignmentWorkspaceIds);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const workspace of workspaces) {
    if (workspace.status !== "active") continue;
    if (!allowed.has(workspace.id)) continue;
    if (seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    out.push(workspace);
  }
  return out;
}

export function filterAssignedWorkspaces<T extends {
  name: string;
  description: string | null;
  category: string;
  slug: string;
}>(
  workspaces: T[],
  opts: { search: string; category: string },
): T[] {
  const term = opts.search.trim().toLowerCase();
  return workspaces.filter((workspace) => {
    if (opts.category && opts.category !== "All" && workspace.category !== opts.category) return false;
    if (!term) return true;
    const haystack = `${workspace.name} ${workspace.description ?? ""} ${workspace.category} ${workspace.slug}`.toLowerCase();
    return haystack.includes(term);
  });
}
