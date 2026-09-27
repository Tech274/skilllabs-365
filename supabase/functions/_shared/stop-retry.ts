/**
 * Cloud-stop retry bookkeeping for the cleanup-idle-labs cron (Riley re-check
 * of #54 / #58). No schema change: the state lives on the VM row itself.
 *
 *   ended_reason = marker (below), ended_at = time of the last stop attempt.
 *
 *   learner_cancel_pending_stop        learner Cancel could not stop the VM yet
 *                                      (e.g. AWS instance still `pending`); the
 *                                      cron orphan pass retries it. 0 retries so far.
 *   learner_cancel_pending_stop:<n>    n cron retries have failed
 *   cleanup_stop_retry:<n>             idle / orphan pass stop failed n times
 *   stop_failed_needs_admin:<n>        gave up after n failed attempts. Automatic
 *                                      retries stop, admins get ONE notification and
 *                                      the row is flagged on /vms until an admin
 *                                      acts (Stop / Delete / Start all clear it).
 *
 * Backoff between cron retries: 5, 10, 20, 40, 60 min (cron runs every 5 min),
 * so a permanently failing stop (VM gone from the cloud, lost permissions)
 * escalates after 6 attempts, about 2.25 hours, instead of retrying and logging
 * an error on every tick forever.
 *
 * Any successful stop (markVmEnded), an admin Stop / Delete, or a Start
 * (start-vm clears ended_reason) overwrites the marker.
 */

export const CANCEL_PENDING_STOP_REASON = "learner_cancel_pending_stop";
export const CLEANUP_STOP_RETRY_REASON = "cleanup_stop_retry";
export const STOP_NEEDS_ADMIN_REASON = "stop_failed_needs_admin";

export const STOP_RETRY_MAX_ATTEMPTS = 6;
export const STOP_RETRY_BASE_MINUTES = 5;
export const STOP_RETRY_MAX_BACKOFF_MINUTES = 60;
/**
 * A cleanup marker whose last attempt is this old is stale (the VM got a new
 * session in between, so the orphan pass skipped it). Start counting again.
 */
export const STOP_RETRY_STALE_HOURS = 24;

export type StopRetryKind = "cancel" | "cleanup" | "needs_admin";

export interface StopRetryState {
  kind: StopRetryKind;
  /** Failed attempts so far (the initial Cancel failure is not counted). */
  attempts: number;
}

const PREFIX: Record<StopRetryKind, string> = {
  cancel: CANCEL_PENDING_STOP_REASON,
  cleanup: CLEANUP_STOP_RETRY_REASON,
  needs_admin: STOP_NEEDS_ADMIN_REASON,
};

export function parseStopRetry(reason: string | null | undefined): StopRetryState | null {
  const raw = String(reason ?? "").trim();
  if (!raw) return null;
  for (const kind of Object.keys(PREFIX) as StopRetryKind[]) {
    const prefix = PREFIX[kind];
    if (raw === prefix) return { kind, attempts: 0 };
    if (raw.startsWith(`${prefix}:`)) {
      const n = Number.parseInt(raw.slice(prefix.length + 1), 10);
      return { kind, attempts: Number.isFinite(n) && n > 0 ? n : 0 };
    }
  }
  return null;
}

export function formatStopRetry(state: StopRetryState): string {
  const prefix = PREFIX[state.kind];
  return state.attempts > 0 ? `${prefix}:${state.attempts}` : prefix;
}

/** Minutes to wait after the `attempts`-th failure before trying again. */
export function stopRetryBackoffMinutes(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(STOP_RETRY_BASE_MINUTES * 2 ** (attempts - 1), STOP_RETRY_MAX_BACKOFF_MINUTES);
}

/**
 * The marker that should drive this run: stale cleanup markers reset to "no
 * marker" (fresh start). Cancel and needs-admin markers never go stale.
 */
export function effectiveStopRetry(
  reason: string | null | undefined,
  lastAttemptIso: string | null | undefined,
  nowMs: number,
): StopRetryState | null {
  const state = parseStopRetry(reason);
  if (!state || state.kind !== "cleanup") return state;
  const last = Date.parse(String(lastAttemptIso ?? ""));
  if (Number.isNaN(last)) return state;
  return nowMs - last > STOP_RETRY_STALE_HOURS * 3600_000 ? null : state;
}

/** May the cron attempt a cloud stop for this row now? */
export function isStopRetryDue(
  state: StopRetryState | null,
  lastAttemptIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (!state) return true;
  if (state.kind === "needs_admin") return false;
  if (state.attempts <= 0) return true;
  const last = Date.parse(String(lastAttemptIso ?? ""));
  if (Number.isNaN(last)) return true;
  return nowMs - last >= stopRetryBackoffMinutes(state.attempts) * 60_000;
}

/** State to write after one more failed attempt. */
export function nextStopRetryAfterFailure(
  current: StopRetryState | null,
  defaultKind: "cancel" | "cleanup",
): { state: StopRetryState; escalated: boolean } {
  const attempts = (current?.attempts ?? 0) + 1;
  const kind: StopRetryKind = current?.kind ?? defaultKind;
  if (kind === "needs_admin") return { state: { kind, attempts }, escalated: false };
  if (attempts >= STOP_RETRY_MAX_ATTEMPTS) {
    return { state: { kind: "needs_admin", attempts }, escalated: true };
  }
  return { state: { kind, attempts }, escalated: false };
}

const LIVE = new Set(["starting", "running", "idle"]);

/**
 * May the owner's Start (start-vm) "take back" a pending Cancel stop on a live
 * VM? True for a learner-cancel marker on starting/running/idle, and for a
 * needs-admin row that is still `starting` (a Cancel whose stop never went
 * through). A needs-admin flag on a running VM from the idle/orphan passes is
 * NOT cleared by a learner Start, so the admin signal is not lost.
 */
export function isLearnerResumablePendingStop(
  status: string | null | undefined,
  reason: string | null | undefined,
): boolean {
  const st = String(status ?? "").toLowerCase();
  if (!LIVE.has(st)) return false;
  const state = parseStopRetry(reason);
  if (!state) return false;
  if (state.kind === "cancel") return true;
  return state.kind === "needs_admin" && st === "starting";
}
