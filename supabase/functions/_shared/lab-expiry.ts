/**
 * Soft-expiry decisions for the cleanup-idle-labs cron (SCRUM-28).
 *
 * One pure function decides whether a lab VM must be soft-stopped because its
 * access is over. Everything here is side-effect free so it can be unit-tested
 * and reused by the admin `expiry-preview` dry run.
 *
 * Policy (unchanged product law): expiry DEALLOCATES and notifies. It never
 * terminates or deletes a VM. Hard delete stays admin-only.
 *
 * Triggers, in priority order:
 *   1. `virtual_machines.expires_at` is in the past            → lab_window_expired
 *   2. persistent template end_date (EOD IST) has passed        → lab_window_expired
 *   3. learner's prepaid minutes for the template are used up   → lab_minutes_exhausted
 *
 * The end-date rule uses the SAME wallet snapshot as the learner Start gate
 * (`buildWalletSnapshot`), so the sweep and the gate always agree: a VM the
 * sweep deallocates cannot be restarted by the learner, and vice versa.
 */

import { buildWalletSnapshot, type WalletSessionRow } from "./lab-wallet.ts";

/**
 * Hub statuses where compute may still be billing, so an expired lab must be
 * soft-stopped. `idle` is running compute with no activity; `stopped` is an
 * OS-level shutdown — on Azure that is still allocated (and billed) until it
 * is deallocated.
 */
export const SOFT_EXPIRY_STATUSES = [
  "running",
  "provisioning",
  "starting",
  "idle",
  "stopped",
] as const;

/** Live statuses swept as orphans when no session is active. */
export const ORPHAN_SWEEP_STATUSES = ["running", "idle"] as const;

export type SoftExpiryReason = "lab_window_expired" | "lab_minutes_exhausted";
export type SoftExpiryTrigger = "expires_at" | "template_end_date" | "minutes_exhausted";

export type SoftExpiryTemplate = {
  name?: string | null;
  duration?: number | null;
  is_persistent?: boolean | null;
  end_date?: string | null;
};

export type SoftExpiryInput = {
  status: string | null | undefined;
  expiresAt?: string | null;
  template?: SoftExpiryTemplate | null;
  /** This learner's sessions on the template (wallet usage). */
  sessions?: WalletSessionRow[];
  nowMs: number;
};

export type SoftExpiryDecision = {
  reason: SoftExpiryReason;
  trigger: SoftExpiryTrigger;
  allocatedMinutes?: number;
  usedMinutes?: number;
};

export function isSoftExpiryStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (SOFT_EXPIRY_STATUSES as readonly string[]).includes(String(status).toLowerCase());
}

/** Returns why this VM must be soft-stopped now, or null to leave it alone. */
export function decideSoftExpiry(input: SoftExpiryInput): SoftExpiryDecision | null {
  if (!isSoftExpiryStatus(input.status)) return null;

  if (input.expiresAt) {
    const expires = Date.parse(input.expiresAt);
    if (!Number.isNaN(expires) && expires < input.nowMs) {
      return { reason: "lab_window_expired", trigger: "expires_at" };
    }
  }

  const tpl = input.template;
  if (!tpl) return null;

  const snap = buildWalletSnapshot({
    duration: tpl.duration,
    endDate: tpl.end_date,
    isPersistent: tpl.is_persistent,
    sessions: input.sessions ?? [],
    nowMs: input.nowMs,
  });
  if (snap.windowEnded) {
    return {
      reason: "lab_window_expired",
      trigger: "template_end_date",
      allocatedMinutes: snap.allocatedMinutes,
      usedMinutes: snap.usedMinutes,
    };
  }
  if (snap.exhausted) {
    return {
      reason: "lab_minutes_exhausted",
      trigger: "minutes_exhausted",
      allocatedMinutes: snap.allocatedMinutes,
      usedMinutes: snap.usedMinutes,
    };
  }
  return null;
}

/** Learner + admin notification copy for a soft-expiry. */
export function softExpiryNotice(
  decision: SoftExpiryDecision,
  label: string,
  templateName?: string | null,
): { type: string; title: string; message: string } {
  const lab = templateName ? `Lab ${templateName}` : "Your lab";
  if (decision.trigger === "expires_at") {
    return {
      type: "lab_expired",
      title: "Lab window expired — VM deallocated",
      message:
        `Lab VM ${label} reached expires_at and was soft-stopped (deallocated). Resources are held, not deleted. Contact an admin to resume or purge.`,
    };
  }
  if (decision.trigger === "template_end_date") {
    return {
      type: "lab_expired",
      title: "Lab window ended — VM deallocated",
      message:
        `${lab} reached its end date (EOD IST). VM ${label} was deallocated. Resources are held, not deleted.`,
    };
  }
  return {
    type: "lab_minutes_exhausted",
    title: "Lab minutes used up — VM deallocated",
    message:
      `${lab} used all ${decision.allocatedMinutes ?? 0} allocated minutes. VM ${label} was deallocated. Resources are held, not deleted.`,
  };
}
