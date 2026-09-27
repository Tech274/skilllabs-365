/**
 * SCRUM-106 — learner Cancel outcome. The edge function hard-deletes only a
 * fresh, never-used allocation; an existing / previously used lab machine is
 * soft-stopped (deallocated) and kept for Start. The UI must say which.
 */
export interface CancelOutcome {
  vmId: string;
  labId: string | null;
  /** true only when the backend removed the machine. */
  deleted: boolean;
  /** Hub status after cancel (e.g. "deallocated") when the machine was kept. */
  status: string | null;
}

export function parseCancelResponse(
  vmId: string,
  labId: string | null,
  data: unknown,
): CancelOutcome {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  // Older deployments return { action: "cancelled" } without `deleted`; that path deleted.
  const kept = body.deleted === false || body.action === "cancel-soft-stopped";
  return {
    vmId,
    labId,
    deleted: !kept,
    status: kept && typeof body.status === "string" ? body.status : null,
  };
}

/** Local dashboard card status for a kept VM whose cloud stop is still pending. */
export const PAUSING_CARD_STATUS = "pausing";

const LIVE_AFTER_CANCEL = new Set(["provisioning", "starting", "running", "idle"]);

/** True when Cancel kept the VM but the cloud stop has not gone through yet. */
export function isPendingStopOutcome(outcome: CancelOutcome): boolean {
  return !outcome.deleted && !!outcome.status && LIVE_AFTER_CANCEL.has(outcome.status.toLowerCase());
}

/**
 * Card status to show after Cancel (Riley #58): a kept VM that is still
 * powering on shows "Pausing…" (the cron finishes the stop), never "Starting".
 */
export function cardStatusAfterCancel(outcome: CancelOutcome): string | null {
  if (outcome.deleted || !outcome.status) return null;
  return isPendingStopOutcome(outcome) ? PAUSING_CARD_STATUS : outcome.status;
}

export function cancelToastCopy(outcome: CancelOutcome): { title: string; description: string } {
  if (outcome.deleted) {
    return { title: "Provisioning Cancelled", description: "Your VM has been removed." };
  }
  if (outcome.status && outcome.status.toLowerCase() === "deallocated") {
    return {
      title: "Lab paused",
      description: "Your lab machine was kept (not deleted). Press Start to resume where you left off.",
    };
  }
  if (isPendingStopOutcome(outcome)) {
    return {
      title: "Pausing lab",
      description:
        "Your lab machine was NOT deleted. It was still powering on, so it will pause automatically within a few minutes. Press Start if you want to keep using it instead.",
    };
  }
  return {
    title: "Lab kept",
    description: "Your lab machine was NOT deleted. It may take a minute to finish pausing — press Start to resume.",
  };
}
