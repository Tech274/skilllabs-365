// Connect preflight — additive, read-only.
// Before any Admin or learner Connect we ask the server-side `network-health`
// edge function whether the TARGET Guacamole gateway is healthy.
// RED  -> Connect is blocked with a clear, honest error (target, reason, last check).
// AMBER/GREEN -> Connect proceeds (amber is degraded, not down).
// A failed preflight NEVER deallocates or touches the machine.
import { supabase } from "@/integrations/supabase/client";

export type GuacTargetId = "guac_aws" | "guac_azure";

export interface PreflightCheck {
  id: string;
  label: string;
  url: string;
  status: "green" | "amber" | "red";
  reason: string;
  httpStatus: number | null;
}

export interface PreflightResult {
  ok: boolean;
  check: PreflightCheck | null;
  checkedAt: string;
  /** Human-readable blocking message (only set when ok === false). */
  message: string | null;
}

/** Map a VM/lab cloud provider onto its Guacamole gateway probe target. */
export function guacTargetForProvider(provider: string | null | undefined): GuacTargetId {
  const p = (provider || "").trim().toLowerCase();
  return p === "aws" ? "guac_aws" : "guac_azure";
}

export function formatPreflightTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })} IST`;
}

/**
 * Probe the gateway for this provider. Fails OPEN only when the health service
 * itself is unavailable (we never silently claim green for a RED gateway).
 */
export async function preflightGuac(provider: string | null | undefined): Promise<PreflightResult> {
  const target = guacTargetForProvider(provider);
  try {
    const { data, error } = await supabase.functions.invoke("network-health", {
      body: { target },
    });
    if (error) throw error;
    const checks: PreflightCheck[] = Array.isArray(data?.checks) ? data.checks : [];
    const check = checks.find((c) => c.id === target) ?? null;
    const checkedAt: string = data?.checked_at || new Date().toISOString();
    if (check && check.status === "red") {
      return {
        ok: false,
        check,
        checkedAt,
        message: `${check.label} gateway is DOWN (RED). ${check.reason}. Last check ${formatPreflightTime(checkedAt)}. Your lab machine was not changed — nothing was stopped or deleted.`,
      };
    }
    return { ok: true, check, checkedAt, message: null };
  } catch (err) {
    // Health service unreachable — do not block, but surface nothing false.
    console.error("Connect preflight could not reach network-health:", err);
    return { ok: true, check: null, checkedAt: new Date().toISOString(), message: null };
  }
}
