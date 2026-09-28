/**
 * Lab REMINT helpers (Leave → Start same allocation).
 *
 * Disconnect is not deallocate. When a learner returns to a lab whose machine
 * is powered off, we START that same allocation, wait until it reports
 * `running`, and only then ask guacamole-proxy for a tokenized desktop URL.
 *
 * Persistent labs remint through provision-lab with the pinned vm_id. That
 * path resumes the existing machine; it does not create a new one. Other labs
 * resume through cleanup-idle-labs `start-vm`. Each click sends a fresh
 * Idempotency-Key. The key is dropped on success, on failure, and when the
 * 180s running wait times out, so the next click is a new request and not a
 * replay of the stored 200. A 409 while that key is still in progress keeps
 * the key and is shown as "already starting", not as a failed start.
 * Double-clicks are refused by the in-flight guard (the Start button is also
 * disabled while the call runs).
 *
 * We never open Guacamole — and never claim "Connected" — while the machine is
 * deallocated/stopped/starting.
 */

import { supabase } from "@/integrations/supabase/client";
import { readFunctionError, readFunctionErrorPayload } from "@/lib/function-error";
import { freshIdempotencyHeaders, resetIdempotency } from "@/lib/idempotency";

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

/** A second Start while this VM's remint request is still in flight. */
export class AlreadyStartingError extends Error {
  constructor(message = "This lab is already starting.") {
    super(message);
    this.name = "AlreadyStartingError";
  }
}

const inFlightRemints = new Set<string>();

function isAlreadyStartingResponse(
  error: unknown,
  data: unknown,
  payloadError: string,
  message: string,
): boolean {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 409) return true;
  const dataError = data && typeof data === "object" && "error" in data
    ? String((data as { error?: unknown }).error ?? "")
    : "";
  return /already in progress/i.test(payloadError) || /already in progress/i.test(message) || /already in progress/i.test(dataError);
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

/** Scope label for the remint key. The key itself is minted fresh per click. */
export function remintIdempotencyScope(opts: {
  vmId: string;
  labTemplateId?: string | null;
  isPersistent?: boolean;
}): string {
  if (opts.isPersistent && opts.labTemplateId) return `provision:${opts.labTemplateId}:${opts.vmId}`;
  return `start-vm:${opts.vmId}`;
}

/**
 * Power the existing allocation back on and poll check-vm-status until it
 * reports `running`. Persistent labs call provision-lab with the same vm_id.
 * Other labs call cleanup-idle-labs start-vm. Neither path creates a new VM.
 */
export async function remintAndWaitRunning(opts: RemintOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 5_000;
  if (!opts.vmId) throw new Error(REMINT_FAIL_CODE);
  if (inFlightRemints.has(opts.vmId)) {
    throw new AlreadyStartingError();
  }
  inFlightRemints.add(opts.vmId);
  const scope = remintIdempotencyScope(opts);
  let preserveKey = false;
  let minted = false;
  try {
    if (!opts.alreadyStarting) {
      opts.onPhase?.("starting");
      const usePersistentRemint = Boolean(opts.isPersistent && opts.labTemplateId);
      const headers = freshIdempotencyHeaders(scope);
      minted = true;
      const { data, error } = usePersistentRemint
        ? await supabase.functions.invoke("provision-lab", {
            body: { lab_template_id: opts.labTemplateId, vm_id: opts.vmId },
            headers,
          })
        : await supabase.functions.invoke("cleanup-idle-labs", {
            body: { action: "start-vm", vm_id: opts.vmId, reason: "learner_start" },
            headers,
          });
      if (error || data?.error) {
        const payload = await readFunctionErrorPayload(error, data);
        const msg = await readFunctionError(error, data);
        if (isAlreadyStartingResponse(error, data, String(payload?.error ?? ""), msg)) {
          // Same key is still in progress on the server. Keep it and do not start again.
          preserveKey = true;
          throw new AlreadyStartingError();
        }
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
      // Drop the key as soon as the start call succeeds, before the running poll.
      // The next click (after Leave, or a retry) must not replay this 200.
      resetIdempotency(scope);
      minted = false;
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
    // The start call may already have dropped the key. Drop it again here so a
    // timed-out wait cannot leave a stored 200 for the next click to replay.
    resetIdempotency(scope);
    throw new Error(`${REMINT_FAIL_CODE}: timed out waiting for running after ${timeoutMs}ms`);
  } catch (err) {
    if (!preserveKey) resetIdempotency(scope);
    throw err;
  } finally {
    inFlightRemints.delete(opts.vmId);
  }
}

/**
 * Admin Start on /vms. Persistent labs use the same fresh-key remint as a
 * learner, including the 180s running-wait timeout. Other labs call cleanup
 * `start-vm` with reason `admin_start` and do not wait for running. Either
 * way the key is new per click, dropped on success and on failure, and kept
 * when the server returns 409.
 */
export async function adminStartVm(opts: {
  vmId: string;
  labTemplateId?: string | null;
  isPersistent?: boolean;
  onPhase?: RemintOptions["onPhase"];
  timeoutMs?: number;
  pollMs?: number;
}): Promise<void> {
  if (opts.isPersistent && opts.labTemplateId) {
    await remintAndWaitRunning({
      vmId: opts.vmId,
      labTemplateId: opts.labTemplateId,
      isPersistent: true,
      onPhase: opts.onPhase,
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
    });
    return;
  }
  if (!opts.vmId) throw new Error(REMINT_FAIL_CODE);
  if (inFlightRemints.has(opts.vmId)) throw new AlreadyStartingError();
  inFlightRemints.add(opts.vmId);
  const scope = remintIdempotencyScope({ vmId: opts.vmId });
  let preserveKey = false;
  let minted = false;
  try {
    const headers = freshIdempotencyHeaders(scope);
    minted = true;
    const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
      body: { action: "start-vm", vm_id: opts.vmId, reason: "admin_start" },
      headers,
    });
    if (error || data?.error) {
      const payload = await readFunctionErrorPayload(error, data);
      const msg = await readFunctionError(error, data);
      if (isAlreadyStartingResponse(error, data, String(payload?.error ?? ""), msg)) {
        preserveKey = true;
        throw new AlreadyStartingError();
      }
      const code = String(payload?.code ?? data?.code ?? "");
      console.error("[admin-start] start failed:", msg, code, payload?.detail, payload?.aws_state);
      throw new Error(msg || REMINT_FAIL_CODE);
    }
    resetIdempotency(scope);
    minted = false;
  } catch (err) {
    if (minted && !preserveKey) resetIdempotency(scope);
    throw err;
  } finally {
    inFlightRemints.delete(opts.vmId);
  }
}
