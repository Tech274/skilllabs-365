/**
 * SCRUM-106 — learner Cancel must never delete a lab VM that already holds
 * learner work (persistent-lab rule: stop/resume same VM, no mid-window delete).
 *
 * The provisioning panel's Cancel button is shown for a fresh Launch AND for
 * Start/resume of an existing allocation. Only a fresh, never-used allocation
 * may be hard-deleted by a learner; anything else is soft-stopped (deallocated),
 * exactly like Leave. Admin / service-role cancel keeps the hard-delete path.
 */

export type LearnerCancelMode = "delete" | "soft_stop";

export interface LearnerCancelInput {
  /** Platform admin or service-role caller. */
  isAdmin: boolean;
  /** Current Hub status of the VM row. */
  status: string | null | undefined;
  /** Count of sessions on this vm_id that already ended (ended_at not null). */
  completedSessions: number;
}

export interface LearnerCancelDecision {
  mode: LearnerCancelMode;
  reason:
    | "admin_cancel"
    | "fresh_allocation"
    | "already_soft_stopped"
    | "resuming_existing_vm"
    | "used_allocation";
}

/** Statuses that only occur on an existing allocation (Start / remint or held). */
const SOFT_STOPPED = new Set(["deallocated", "stopped"]);
const RESUMING = new Set(["starting"]);

export function decideLearnerCancel(input: LearnerCancelInput): LearnerCancelDecision {
  if (input.isAdmin) return { mode: "delete", reason: "admin_cancel" };
  const status = String(input.status ?? "").toLowerCase();
  if (SOFT_STOPPED.has(status)) return { mode: "soft_stop", reason: "already_soft_stopped" };
  if (RESUMING.has(status)) return { mode: "soft_stop", reason: "resuming_existing_vm" };
  if (Number(input.completedSessions) > 0) return { mode: "soft_stop", reason: "used_allocation" };
  return { mode: "delete", reason: "fresh_allocation" };
}
