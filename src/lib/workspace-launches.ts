/** Pure helpers for the admin workspace launch-event report. */

export interface WorkspaceLaunchRow {
  id: string;
  created_at: string;
  user_id: string;
  user_email: string | null;
  workspace_id: string | null;
  workspace_name: string;
  launch_type: string;
  launch_url: string;
  generated_email: string | null;
}

export interface LaunchFilters {
  user?: string;
  workspace?: string;
  launchType?: string;
  from?: Date | null;
  to?: Date | null;
}

export function filterLaunchRows(rows: WorkspaceLaunchRow[], f: LaunchFilters): WorkspaceLaunchRow[] {
  const user = (f.user ?? "").trim().toLowerCase();
  const workspace = (f.workspace ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (user && !`${r.user_email ?? ""} ${r.user_id}`.toLowerCase().includes(user)) return false;
    if (workspace && workspace !== "all" && r.workspace_name.toLowerCase() !== workspace) return false;
    if (f.launchType && f.launchType !== "all" && r.launch_type !== f.launchType) return false;
    const at = new Date(r.created_at).getTime();
    if (f.from && at < f.from.getTime()) return false;
    if (f.to && at > f.to.getTime()) return false;
    return true;
  });
}

export const LAUNCH_CSV_COLUMNS: Array<{ key: keyof WorkspaceLaunchRow; label: string }> = [
  { key: "created_at", label: "Timestamp" },
  { key: "user_email", label: "User" },
  { key: "user_id", label: "User ID" },
  { key: "workspace_name", label: "Workspace" },
  { key: "launch_type", label: "Launch type" },
  { key: "generated_email", label: "Workspace email" },
  { key: "launch_url", label: "URL" },
];

function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toLaunchCsv(rows: WorkspaceLaunchRow[]): string {
  const header = LAUNCH_CSV_COLUMNS.map((c) => c.label).join(",");
  const lines = rows.map((r) => LAUNCH_CSV_COLUMNS.map((c) => cell(r[c.key])).join(","));
  return [header, ...lines].join("\n");
}

/** Ranks workspace ids by recent usage: most launches first, ties broken by recency. */
export function rankRecentWorkspaces(
  events: Array<{ workspace_id: string | null; created_at: string }>,
): string[] {
  const stats = new Map<string, { count: number; last: number }>();
  for (const e of events) {
    if (!e.workspace_id) continue;
    const at = new Date(e.created_at).getTime();
    const prev = stats.get(e.workspace_id);
    if (prev) {
      prev.count += 1;
      prev.last = Math.max(prev.last, at);
    } else {
      stats.set(e.workspace_id, { count: 1, last: at });
    }
  }
  return [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .map(([id]) => id);
}

/** Favorites first, then most-used, then everything else in its original order. */
export function orderByAffinity<T extends { id: string }>(
  items: T[],
  favorites: Set<string>,
  recentOrder: string[],
): T[] {
  const recentRank = new Map(recentOrder.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const fa = favorites.has(a.id) ? 0 : 1;
    const fb = favorites.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ra = recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}
