// Outcome of an admin persistent Start that was allowed past the owner wallet gate.
// Minutes are never deducted on this path. `failed` is recorded by the caller
// when StartInstances (or the provider start) was rejected.

export type AdminStartOverrideOutcome =
  | "already_running"
  | "already_starting"
  | "start_accepted"
  | "running"
  | "failed";

/**
 * Classify the restart that actually happened.
 * `didStart` is false when no cloud start was sent because the VM was already
 * live. Starting or provisioning in that case is `already_starting`, distinct
 * from `already_running` (running/idle) and from `start_accepted` (a start
 * was sent and the VM is still coming up).
 */
export function adminRestartOutcome(
  didStart: boolean,
  status: string,
): Exclude<AdminStartOverrideOutcome, "failed"> {
  const normalized = String(status || "").toLowerCase();
  const live = normalized === "running" || normalized === "idle";
  if (!didStart) {
    if (live) return "already_running";
    if (normalized === "starting" || normalized === "provisioning") return "already_starting";
  }
  return live ? "running" : "start_accepted";
}

export function adminStartOverrideMessage(
  restartOutcome: AdminStartOverrideOutcome,
  errorCode?: string,
): string {
  switch (restartOutcome) {
    case "failed":
      return `Admin Start did not power the VM on${errorCode ? ` (${errorCode})` : ""}. Minutes were not deducted.`;
    case "already_running":
      return "Admin Start found the VM already running. Minutes were not deducted.";
    case "already_starting":
      return "Admin Start found the VM already starting. Minutes were not deducted.";
    case "running":
      return "Admin Start powered the VM on. Minutes were not deducted.";
    case "start_accepted":
      return "Admin Start was accepted; the VM is still starting. Minutes were not deducted.";
  }
}
