/**
 * Persistent lab REMINT helpers (Leave → return).
 *
 * Disconnect is not deallocate. When a learner (or a Super Admin barging in)
 * returns to a lab whose machine is powered off, we must START the existing
 * allocation first (provision-lab remint), wait until it reports `running`,
 * and only then ask guacamole-proxy for a tokenized desktop URL.
 *
 * We never open Guacamole — and never claim "Connected" — while the machine is
 * deallocated/stopped/starting.
 */

import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/function-error";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";

/** Machine states where the allocation exists but compute is not live yet. */
export const REMINT_STATUSES = ["deallocated", "stopped", "starting"] as const;

export function needsRemint(status: string | null | undefined): boolean {
  if (!status) return false;
  return (REMINT_STATUSES as readonly string[]).includes(String(status).toLowerCase());
}

export const REMINT_FAIL_CODE = "REMINT_START_FAILED";

export const REMINT_CALM_COPY =
  "Your lab machine is still waking up. Nothing was lost — please try Connect again in a moment.";

export type RemintOptions = {
  vmId: string;
  labTemplateId: string | null;
  /** Skip the start call when the machine is already powering on. */
  alreadyStarting?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  onPhase?: (phase: "starting" | "waiting-running") => void;
};

/**
 * Start the existing allocation (never create/destroy here) and poll
 * check-vm-status until it reports `running`.
 */
export async function remintAndWaitRunning(opts: RemintOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 5_000;

  if (!opts.alreadyStarting) {
    if (!opts.labTemplateId) throw new Error(REMINT_FAIL_CODE);
    opts.onPhase?.("starting");
    const key = `provision:${opts.labTemplateId}`;
    resetIdempotency(key);
    const { data, error } = await supabase.functions.invoke("provision-lab", {
      body: { lab_template_id: opts.labTemplateId },
      headers: idempotencyHeaders(key),
    });
    if (error || data?.error) {
      console.error("[remint] start failed:", await readFunctionError(error, data));
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
    if (status === "failed" || status === "terminated") throw new Error(REMINT_FAIL_CODE);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(REMINT_FAIL_CODE);
}
