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
  return {
    title: "Lab kept",
    description: "Your lab machine was NOT deleted. It may take a minute to finish pausing — press Start to resume.",
  };
}
