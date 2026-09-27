/**
 * SPA mirror of `supabase/functions/_shared/stop-retry.ts` (keep in sync).
 *
 * cleanup-idle-labs records automatic cloud-stop failures ON THE VM ROW:
 *   ended_reason = learner_cancel_pending_stop[:n] | cleanup_stop_retry:n | stop_failed_needs_admin:n
 *   ended_at     = time of the last attempt
 * After 6 failed attempts the row is flagged stop_failed_needs_admin and the
 * cron stops retrying (admins are notified once).
 */

export const CANCEL_PENDING_STOP_REASON = "learner_cancel_pending_stop";
export const CLEANUP_STOP_RETRY_REASON = "cleanup_stop_retry";
export const STOP_NEEDS_ADMIN_REASON = "stop_failed_needs_admin";
export const STOP_RETRY_MAX_ATTEMPTS = 6;

export type StopRetryKind = "cancel" | "cleanup" | "needs_admin";
export interface StopRetryState {
  kind: StopRetryKind;
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

const LIVE = new Set(["starting", "running", "idle"]);

/**
 * A learner Cancel whose cloud stop is still pending on a live VM: the card
 * shows "Pausing…" and Start calls start-vm, which takes the Cancel back
 * (server: isLearnerResumablePendingStop).
 */
export function isPendingCancelStop(status: string | null | undefined, reason: string | null | undefined): boolean {
  const st = String(status ?? "").toLowerCase();
  if (!LIVE.has(st)) return false;
  const state = parseStopRetry(reason);
  if (!state) return false;
  if (state.kind === "cancel") return true;
  return state.kind === "needs_admin" && st === "starting";
}

/** Admin badge for /vms: automatic stop retrying or given up. */
export function stopRetryBadge(
  reason: string | null | undefined,
): { label: string; tone: "warning" | "destructive"; title: string } | null {
  const state = parseStopRetry(reason);
  if (!state) return null;
  if (state.kind === "needs_admin") {
    return {
      label: "Stop failed — needs admin",
      tone: "destructive",
      title: `Automatic cloud stop failed ${state.attempts} times; retries stopped. Check the cloud console, then Stop or Delete this VM.`,
    };
  }
  if (state.kind === "cancel") {
    return {
      label: state.attempts ? `Cancel stop retry ${state.attempts}/${STOP_RETRY_MAX_ATTEMPTS}` : "Cancel stop pending",
      tone: "warning",
      title: "The learner cancelled while the VM was starting; the cleanup cron is retrying the stop.",
    };
  }
  return {
    label: `Stop retry ${state.attempts}/${STOP_RETRY_MAX_ATTEMPTS}`,
    tone: "warning",
    title: "The idle/orphan cleanup could not stop this VM; the cron retries with backoff.",
  };
}
