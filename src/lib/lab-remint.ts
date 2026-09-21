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

export const REMINT_FAIL_CODE = "REMINT_START_FAILED";

export const REMINT_CALM_COPY =
  "Your lab machine is still waking up. Nothing was lost — please try Connect again in a moment.";

export type RemintOptions = {
  vmId: string;
  /** Kept for callers; start-vm resolves template/wallet server-side. */
  labTemplateId?: string | null;
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
    const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
      body: { action: "start-vm", vm_id: opts.vmId, reason: "learner_start" },
    });
    if (error || data?.error) {
      const payload = await readFunctionErrorPayload(error, data);
      const msg = await readFunctionError(error, data);
      const code = String(payload?.code ?? data?.code ?? "");
      console.error("[remint] start-vm failed:", msg, code, payload?.detail, payload?.aws_state);
      // Surface wallet blocks so the dashboard can show calm copy.
      if (code === "LAB_MINUTES_EXHAUSTED" || code === "LAB_WINDOW_ENDED") {
        throw new Error(String(payload?.error ?? data?.error ?? msg));
      }
      // P0b: never swallow into bare REMINT_START_FAILED — toast must show
      // detail / code / aws_state from the edge function body.
      throw new Error(msg || REMINT_FAIL_CODE);
    }
    // Guard: start-vm must return the SAME vm_id (never a new allocation).
    if (data?.vm_id && String(data.vm_id) !== String(opts.vmId)) {
      console.error("[remint] start-vm returned different vm_id", data.vm_id, opts.vmId);
      throw new Error(REMINT_FAIL_CODE);
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
