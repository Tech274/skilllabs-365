// Client-side model for the immutable reconcile audit trail and its SLA rules.

export const DEFAULT_SLA_MINUTES = 30;

export interface ReconcileTrailRow {
  id: string;
  created_at: string;
  vm_id: string | null;
  lab_template_id: string | null;
  entity_label: string | null;
  provider: string;
  region: string | null;
  step: string;
  attempt: number;
  max_attempts: number;
  backoff_delay_ms: number | null;
  from_state: string | null;
  to_state: string | null;
  outcome: string;
  error_cause: string | null;
  error_message: string | null;
  correlation_id: string | null;
}

export interface TrailSummary {
  key: string;
  vmId: string | null;
  label: string;
  provider: string;
  attempts: number;
  failures: number;
  lastOutcome: string;
  lastAt: string;
  causes: string[];
  rows: ReconcileTrailRow[];
}

const FAILING = new Set(["failed", "retrying", "deferred"]);

export function summarizeTrail(rows: ReconcileTrailRow[]): TrailSummary[] {
  const map = new Map<string, TrailSummary>();
  for (const r of rows) {
    const key = `${r.vm_id ?? r.step}:${r.provider}`;
    const s = map.get(key) ?? {
      key,
      vmId: r.vm_id,
      label: r.entity_label ?? r.vm_id ?? r.step,
      provider: r.provider,
      attempts: 0,
      failures: 0,
      lastOutcome: r.outcome,
      lastAt: r.created_at,
      causes: [],
      rows: [],
    };
    s.rows.push(r);
    s.attempts = Math.max(s.attempts, r.attempt);
    if (FAILING.has(r.outcome)) s.failures++;
    if (r.created_at > s.lastAt) { s.lastAt = r.created_at; s.lastOutcome = r.outcome; }
    if (r.error_cause && !s.causes.includes(r.error_cause)) s.causes.push(r.error_cause);
    map.set(key, s);
  }
  for (const s of map.values()) s.rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function overdueMinutes(expiresAt: string | null, now = Date.now()): number {
  if (!expiresAt) return 0;
  const diff = now - new Date(expiresAt).getTime();
  return diff > 0 ? Math.floor(diff / 60_000) : 0;
}

export function breachesSla(expiresAt: string | null, slaMinutes = DEFAULT_SLA_MINUTES, now = Date.now()): boolean {
  return overdueMinutes(expiresAt, now) >= slaMinutes;
}

const TRAIL_HEADER = [
  "created_at", "lab", "vm_id", "provider", "region", "step",
  "attempt", "max_attempts", "backoff_delay_ms", "from_state", "to_state",
  "outcome", "error_cause", "error_message", "correlation_id",
];

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toTrailCsv(rows: ReconcileTrailRow[]): string {
  return [
    TRAIL_HEADER.join(","),
    ...rows.map((r) => [
      r.created_at, r.entity_label ?? "", r.vm_id ?? "", r.provider, r.region ?? "", r.step,
      r.attempt, r.max_attempts, r.backoff_delay_ms ?? "", r.from_state ?? "", r.to_state ?? "",
      r.outcome, r.error_cause ?? "", r.error_message ?? "", r.correlation_id ?? "",
    ].map(esc).join(",")),
  ].join("\n");
}
