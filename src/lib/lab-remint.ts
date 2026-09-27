/**
 * Lab REMINT helpers (Leave → Start same allocation).
 *
 * Disconnect is not deallocate. When a learner returns to a lab whose machine
 * is powered off, we must START the existing allocation via cleanup-idle-labs
 * `start-vm` (never provision-lab — that spins a NEW VM for non-persistent),
 * wait until it reports `running`, and only then ask guacamole-proxy for a
 * tokenized desktop URL.
 *
 * Persistent and non-persistent both resume the SAME vm_id when wallet allows.
 * We never open Guacamole — and never claim "Connected" — while the machine is
 * deallocated/stopped/starting.
 */

import { supabase } from "@/integrations/supabase/client";
import { readFunctionError, readFunctionErrorPayload } from "@/lib/function-error";

/** Machine states where the allocation exists but compute is not live yet. */
export const REMINT_STATUSES = ["deallocated", "stopped", "starting"] as const;

/** Statuses that mean compute is off and Start should power the same VM. */
export const RESUMABLE_STATUSES = ["deallocated", "stopped"] as const;

export function needsRemint(status: string | null | undefined): boolean {
  if (!status) return false;
  return (REMINT_STATUSES as readonly string[]).includes(String(status).toLowerCase());
}

export function isResumableStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (RESUMABLE_STATUSES as readonly string[]).includes(String(status).toLowerCase());
}

/**
 * SCRUM-21: may the session countdown end the lab now?
 * Only on a trusted expiry — never while the allocation is powered off or
 * waking up (remint), because the on-screen expires_at is the pre-Leave value
 * until Start resets it server-side and the page re-reads it.
 */
export function shouldEndOnCountdown(opts: {
  remainingMs: number;
  reminting: boolean;
  vmStatus: string | null | undefined;
}): boolean {
  if (!Number.isFinite(opts.remainingMs) || opts.remainingMs > 0) return false;
  if (opts.reminting) return false;
  if (needsRemint(opts.vmStatus)) return false;
  return true;
}

export const REMINT_FAIL_CODE = "REMINT_START_FAILED";

export const REMINT_CALM_COPY =
  "Your lab machine is still waking up. Nothing was lost — please try Connect again in a moment.";

/** Thrown when the wallet refuses remint; `message` is the learner-facing toast. */
export class WalletBlockedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "WalletBlockedError";
  }
}

export type RemintOptions = {
  vmId: string;
  /** Required for persistent remint via provision-lab. */
  labTemplateId?: string | null;
  /** Persistent labs remint through provision-lab (same path as learner Connect). */
  isPersistent?: boolean;
  /** Skip the start call when the machine is already powering on. */
  alreadyStarting?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  onPhase?: (phase: "starting" | "waiting-running") => void;
};

/**
 * Power the existing allocation back on via start-vm (same vm_id) and poll
 * check-vm-status until it reports `running`. Never creates a new VM.
 */
export async function remintAndWaitRunning(opts: RemintOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 5_000;

    if (!opts.alreadyStarting) {
    if (!opts.vmId) throw new Error(REMINT_FAIL_CODE);
    opts.onPhase?.("starting");
    const usePersistentRemint = Boolean(opts.isPersistent && opts.labTemplateId);
    const { data, error } = usePersistentRemint
      ? await supabase.functions.invoke("provision-lab", {
          body: { lab_template_id: opts.labTemplateId, vm_id: opts.vmId },
        })
      : await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "start-vm", vm_id: opts.vmId, reason: "learner_start" },
        });
    if (error || data?.error) {
      const payload = await readFunctionErrorPayload(error, data);
      const msg = await readFunctionError(error, data);
      const code = String(payload?.code ?? data?.code ?? "");
      console.error("[remint] start failed:", msg, code, payload?.detail, payload?.aws_state);
      // Surface wallet blocks so the dashboard can show calm copy.
      if (code === "LAB_MINUTES_EXHAUSTED" || code === "LAB_WINDOW_ENDED") {
        throw new WalletBlockedError(code, String(payload?.error ?? data?.error ?? msg));
      }
      // P0b: never swallow into bare REMINT_START_FAILED — toast must show
      // detail / code / aws_state from the edge function body.
      throw new Error(msg || REMINT_FAIL_CODE);
    }
    // Guard: must return the SAME vm_id (never a new allocation).
    if (usePersistentRemint && !data?.vm_id) {
      console.error("[remint] provision-lab returned no vm_id", opts.vmId);
      throw new Error("REMINT_VM_MISMATCH: no vm_id in response");
    }
    if (data?.vm_id && String(data.vm_id) !== String(opts.vmId)) {
      console.error("[remint] start returned different vm_id", data.vm_id, opts.vmId);
      throw new Error(`REMINT_VM_MISMATCH: requested ${opts.vmId}, got ${data.vm_id}`);
    }
  }

  opts.onPhase?.("waiting-running");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data: statusData } = await supabase.functions.invoke("check-vm-status", {
      body: { vm_id: opts.vmId },
    });
    const status = String(statusData?.status ?? "").toLowerCase();
    if (status === "running" || status === "idle") return;
    if (status === "failed" || status === "terminated") {
      throw new Error(
        `${REMINT_FAIL_CODE}: check-vm-status reported ${status} (code may be GHOST_INSTANCE)`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`${REMINT_FAIL_CODE}: timed out waiting for running after ${timeoutMs}ms`);
}
