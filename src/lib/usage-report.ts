/**
 * Thin usage report (SCRUM-22).
 *
 * The old Reports page only rendered `daily_reports` snapshots, which depend on
 * a daily-report job that is not scheduled, so the page was empty. Usage is
 * computed here straight from live `sessions` + `virtual_machines` rows: no cron
 * and no new tables. Minutes use the same rule as the lab wallet: an open
 * session counts through "now".
 */

import { IST_TZ } from "@/lib/lab-template-window";

export type UsageSessionRow = {
  id: string;
  user_id: string | null;
  lab_template_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  status?: string | null;
};

export type UsageVmRow = { status: string | null };
export type UsageTemplateRow = { id: string; name: string | null };
export type UsageProfileRow = { user_id: string; display_name?: string | null; email?: string | null };

export type UsageDay = { date: string; sessions: number; minutes: number };
export type UsageLabRow = { templateId: string; name: string; sessions: number; minutes: number; learners: number };
export type UsageLearnerRow = {
  userId: string;
  name: string;
  email: string | null;
  sessions: number;
  minutes: number;
  lastStartedAt: string | null;
};

export type UsageReport = {
  windowDays: number;
  windowStartIso: string;
  totals: {
    sessions: number;
    minutes: number;
    learners: number;
    avgSessionMinutes: number;
    openSessions: number;
  };
  byDay: UsageDay[];
  byLab: UsageLabRow[];
  byLearner: UsageLearnerRow[];
  vmsByStatus: Record<string, number>;
  liveVms: number;
};

/** Every Hub `vm_status` enum value (for exact per-status counts). */
export const ALL_VM_STATUSES = [
  "provisioning", "starting", "running", "idle", "expired",
  "stopped", "deallocated", "terminated", "failed",
] as const;

/** VM statuses that are (or may be) burning compute right now. */
export const LIVE_VM_STATUSES = ["running", "idle", "starting", "provisioning"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO instant → `YYYY-MM-DD` in IST. */
export function istDay(isoOrMs: string | number): string {
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Start of the window: 00:00 IST, `days - 1` days before today (IST). */
export function usageWindowStart(days: number, nowMs: number): Date {
  const safeDays = Math.max(1, Math.floor(days));
  const today = istDay(nowMs);
  const midnightIst = new Date(`${today}T00:00:00.000+05:30`).getTime();
  return new Date(midnightIst - (safeDays - 1) * DAY_MS);
}

/** Billable minutes for one session (open sessions count through now). */
export function sessionMinutes(row: UsageSessionRow, nowMs: number): number {
  if (!row.started_at) return 0;
  const start = new Date(row.started_at).getTime();
  if (Number.isNaN(start)) return 0;
  const end = row.ended_at ? new Date(row.ended_at).getTime() : nowMs;
  if (Number.isNaN(end) || end <= start) return 0;
  return (end - start) / 60000;
}

export function buildUsageReport(args: {
  sessions: UsageSessionRow[];
  vms: UsageVmRow[];
  templates: UsageTemplateRow[];
  profiles: UsageProfileRow[];
  days: number;
  nowMs?: number;
  /** Exact per-status counts (preferred over `vms`, which may be a capped sample). */
  vmStatusCounts?: Record<string, number>;
}): UsageReport {
  const nowMs = args.nowMs ?? Date.now();
  const windowDays = Math.max(1, Math.floor(args.days));
  const windowStart = usageWindowStart(windowDays, nowMs);
  const startMs = windowStart.getTime();

  const templateName = new Map(args.templates.map((t) => [t.id, t.name?.trim() || "Untitled lab"]));
  const profileOf = new Map(args.profiles.map((p) => [p.user_id, p]));

  const days = new Map<string, UsageDay>();
  for (let i = 0; i < windowDays; i++) {
    const key = istDay(startMs + i * DAY_MS + DAY_MS / 2);
    days.set(key, { date: key, sessions: 0, minutes: 0 });
  }

  const labs = new Map<string, { sessions: number; minutes: number; learners: Set<string> }>();
  const learners = new Map<string, { sessions: number; minutes: number; last: number }>();
  let totalMinutes = 0;
  let totalSessions = 0;
  let openSessions = 0;

  for (const s of args.sessions) {
    if (!s.started_at) continue;
    const started = new Date(s.started_at).getTime();
    if (Number.isNaN(started) || started < startMs || started > nowMs) continue;
    const minutes = sessionMinutes(s, nowMs);
    totalSessions += 1;
    totalMinutes += minutes;
    if (!s.ended_at) openSessions += 1;

    const day = days.get(istDay(started));
    if (day) {
      day.sessions += 1;
      day.minutes += minutes;
    }

    const labKey = s.lab_template_id ?? "__none__";
    const lab = labs.get(labKey) ?? { sessions: 0, minutes: 0, learners: new Set<string>() };
    lab.sessions += 1;
    lab.minutes += minutes;
    if (s.user_id) lab.learners.add(s.user_id);
    labs.set(labKey, lab);

    if (s.user_id) {
      const l = learners.get(s.user_id) ?? { sessions: 0, minutes: 0, last: 0 };
      l.sessions += 1;
      l.minutes += minutes;
      l.last = Math.max(l.last, started);
      learners.set(s.user_id, l);
    }
  }

  const vmsByStatus: Record<string, number> = {};
  if (args.vmStatusCounts) {
    for (const [status, n] of Object.entries(args.vmStatusCounts)) {
      if (n > 0) vmsByStatus[status.toLowerCase()] = (vmsByStatus[status.toLowerCase()] ?? 0) + n;
    }
  } else {
    for (const vm of args.vms) {
      const key = (vm.status ?? "unknown").toLowerCase();
      vmsByStatus[key] = (vmsByStatus[key] ?? 0) + 1;
    }
  }
  const liveVms = LIVE_VM_STATUSES.reduce((n, st) => n + (vmsByStatus[st] ?? 0), 0);

  const byLab: UsageLabRow[] = [...labs.entries()]
    .map(([id, v]) => ({
      templateId: id,
      name: id === "__none__" ? "No lab template" : templateName.get(id) ?? "Unknown lab",
      sessions: v.sessions,
      minutes: Math.round(v.minutes),
      learners: v.learners.size,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions);

  const byLearner: UsageLearnerRow[] = [...learners.entries()]
    .map(([userId, v]) => {
      const p = profileOf.get(userId);
      const name = p?.display_name?.trim() || p?.email?.trim() || `${userId.slice(0, 8)}…`;
      return {
        userId,
        name,
        email: p?.email ?? null,
        sessions: v.sessions,
        minutes: Math.round(v.minutes),
        lastStartedAt: v.last ? new Date(v.last).toISOString() : null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions);

  return {
    windowDays,
    windowStartIso: windowStart.toISOString(),
    totals: {
      sessions: totalSessions,
      minutes: Math.round(totalMinutes),
      learners: learners.size,
      avgSessionMinutes: totalSessions ? Math.round(totalMinutes / totalSessions) : 0,
      openSessions,
    },
    byDay: [...days.values()].map((d) => ({ ...d, minutes: Math.round(d.minutes) })),
    byLab,
    byLearner,
    vmsByStatus,
    liveVms,
  };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Per-learner CSV for the selected window. */
export function usageLearnersCsv(report: UsageReport): string {
  const header = ["learner", "email", "sessions", "minutes", "last_started_ist"];
  const rows = report.byLearner.map((l) => [
    csvCell(l.name),
    csvCell(l.email),
    csvCell(l.sessions),
    csvCell(l.minutes),
    csvCell(l.lastStartedAt ? istDay(l.lastStartedAt) : ""),
  ].join(","));
  return [header.join(","), ...rows].join("\n");
}

/** `90` → `1h 30m`; `45` → `45m`. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
