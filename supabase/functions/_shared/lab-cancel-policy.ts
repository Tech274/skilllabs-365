/**
 * SCRUM-106 — learner Cancel must never delete a lab VM that already holds
 * learner work (persistent-lab rule: stop/resume same VM, no mid-window delete).
 *
 * The provisioning panel's Cancel button is shown for a fresh Launch AND for
 * Start/resume of an existing allocation (and when re-attaching to a live one).
 * Only a fresh, never-used allocation may be hard-deleted from that panel;
 * anything else is soft-stopped (deallocated), exactly like Leave.
 *
 * Review follow-up (Atlas):
 *   - ANY session on the VM (active or ended) counts as use. The first version
 *     counted only ended sessions, so a VM on its first, still-active session
 *     (learner working in another tab / closed the tab without Leave) was
 *     hard-deleted on Cancel.
 *   - Persistent templates (or unknown persistence) are only deletable while the
 *     VM is still `provisioning` — never mid-window once it has come up.
 *   - A platform admin clicking the learner panel's Cancel no longer implies a
 *     hard delete. Hard delete needs the service role (operator retry) or an
 *     admin sending an explicit `force_delete: true`.
 */

export type LearnerCancelMode = "delete" | "soft_stop";

export interface LearnerCancelInput {
  /** Service-role caller (e.g. provisioning-retry operator path). */
  isServiceRole?: boolean;
  /** Platform admin caller. */
  isAdmin: boolean;
  /** Admin explicitly asked for a hard delete (`force_delete: true`). */
  forceDelete?: boolean;
  /** Current Hub status of the VM row. */
  status: string | null | undefined;
  /** Count of ALL sessions on this vm_id (active or ended). */
  priorSessions: number;
  /** lab_templates.is_persistent; null/undefined = unknown (treated as persistent). */
  isPersistent?: boolean | null;
}

export interface LearnerCancelDecision {
  mode: LearnerCancelMode;
  reason:
    | "admin_cancel"
    | "fresh_allocation"
    | "already_soft_stopped"
    | "resuming_existing_vm"
    | "used_allocation"
    | "persistent_mid_window";
}

/** Statuses that only occur on an existing allocation (Start / remint or held). */
const SOFT_STOPPED = new Set(["deallocated", "stopped"]);
const RESUMING = new Set(["starting"]);

export function decideLearnerCancel(input: LearnerCancelInput): LearnerCancelDecision {
  if (input.isServiceRole || (input.isAdmin && input.forceDelete === true)) {
    return { mode: "delete", reason: "admin_cancel" };
  }
  const status = String(input.status ?? "").toLowerCase();
  if (SOFT_STOPPED.has(status)) return { mode: "soft_stop", reason: "already_soft_stopped" };
  if (RESUMING.has(status)) return { mode: "soft_stop", reason: "resuming_existing_vm" };
  if (Number(input.priorSessions) > 0) return { mode: "soft_stop", reason: "used_allocation" };
  if (input.isPersistent !== false && status !== "provisioning") {
    return { mode: "soft_stop", reason: "persistent_mid_window" };
  }
  return { mode: "delete", reason: "fresh_allocation" };
}

/** Marker left on a VM whose Cancel soft-stop could not stop the cloud VM yet. */
export const CANCEL_PENDING_STOP_REASON = "learner_cancel_pending_stop";
