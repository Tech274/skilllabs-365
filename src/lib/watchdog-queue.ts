// Watchdog retry / reconcile queue model used by the admin observability view.
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_MS = 400;
export const RETRY_MAX_DELAY_MS = 8000;

export function backoffDelayMs(attempt: number, baseMs = RETRY_BASE_MS, maxDelayMs = RETRY_MAX_DELAY_MS): number {
  const raw = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, maxDelayMs);
}

export interface BackoffStep { attempt: number; delayMs: number; cumulativeMs: number; }

export function backoffSchedule(attempts = RETRY_ATTEMPTS, baseMs = RETRY_BASE_MS, maxDelayMs = RETRY_MAX_DELAY_MS): BackoffStep[] {
  const steps: BackoffStep[] = [];
  let cumulative = 0;
  for (let attempt = 1; attempt < attempts; attempt++) {
    const delayMs = backoffDelayMs(attempt, baseMs, maxDelayMs);
    cumulative += delayMs;
    steps.push({ attempt, delayMs, cumulativeMs: cumulative });
  }
  return steps;
}

export interface WatchdogFailureRow {
  id: string; created_at: string; entity_id: string | null; entity_label: string | null;
  message: string | null; changes: { step?: string; provider?: string | null; vm_id?: string | null } | null;
}
export interface QueuedVm {
  id: string; provider: string; status: string; region: string | null; expires_at: string | null; lab_name?: string | null;
}
export type QueueState = "due" | "pending" | "failing" | "healthy";
export interface QueueEntry {
  key: string; vmId: string | null; labLabel: string; provider: string; region: string | null;
  status: string | null; expiresAt: string | null; steps: string[]; attempts: number;
  lastFailureAt: string | null; lastError: string | null; nextRetryInMs: number | null;
  exhausted: boolean; state: QueueState;
}

export function isDue(vm: QueuedVm, now = Date.now()): boolean {
  return Boolean(vm.expires_at && new Date(vm.expires_at).getTime() <= now);
}

export function buildWatchdogQueue(failures: WatchdogFailureRow[], vms: QueuedVm[], now = Date.now()): QueueEntry[] {
  const byVm = new Map<string, QueueEntry>();
  const ensure = (key: string, seed: Partial<QueueEntry>): QueueEntry => {
    const existing = byVm.get(key);
    if (existing) return existing;
    const entry: QueueEntry = {
      key, vmId: seed.vmId ?? null, labLabel: seed.labLabel ?? "Unknown lab",
      provider: seed.provider ?? "unknown", region: seed.region ?? null, status: seed.status ?? null,
      expiresAt: seed.expiresAt ?? null, steps: [], attempts: 0, lastFailureAt: null, lastError: null,
      nextRetryInMs: null, exhausted: false, state: "healthy",
    };
    byVm.set(key, entry);
    return entry;
  };
  for (const vm of vms) {
    const entry = ensure(vm.id, { vmId: vm.id, labLabel: vm.lab_name ?? vm.id, provider: vm.provider, region: vm.region, status: vm.status, expiresAt: vm.expires_at });
    entry.state = isDue(vm, now) ? "due" : "pending";
  }
  for (const f of failures) {
    const vmId = f.changes?.vm_id ?? f.entity_id ?? null;
    const key = vmId ?? `${f.changes?.step ?? "run"}:${f.changes?.provider ?? "unknown"}`;
    const entry = ensure(key, { vmId, labLabel: f.entity_label ?? vmId ?? (f.changes?.step ?? "watchdog run"), provider: f.changes?.provider ?? "unknown" });
    entry.attempts += 1;
    const step = f.changes?.step;
    if (step && !entry.steps.includes(step)) entry.steps.push(step);
    if (!entry.lastFailureAt || f.created_at > entry.lastFailureAt) {
      entry.lastFailureAt = f.created_at;
      entry.lastError = f.message ?? null;
    }
  }
  for (const entry of byVm.values()) {
    if (entry.attempts > 0) {
      entry.state = "failing";
      entry.exhausted = entry.attempts >= RETRY_ATTEMPTS;
      entry.nextRetryInMs = entry.exhausted ? null : backoffDelayMs(entry.attempts);
    }
  }
  const rank: Record<QueueState, number> = { failing: 0, due: 1, pending: 2, healthy: 3 };
  return [...byVm.values()].sort((a, b) => rank[a.state] - rank[b.state] || (b.lastFailureAt ?? "").localeCompare(a.lastFailureAt ?? ""));
}

export function formatDelay(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${ms}ms`;
}
