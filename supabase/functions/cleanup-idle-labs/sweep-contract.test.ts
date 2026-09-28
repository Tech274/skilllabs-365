import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Review follow-up (SCRUM-28): source-level guards for the auto-cleanup passes.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("idle / orphan cloud errors are isolated per VM (run never aborts)", () => {
  assert(src.includes('event: "idle_deallocate_failed"'));
  assert(src.includes('event: "orphan_deallocate_failed"'));
});

Deno.test("held VMs are skipped by every automatic pass and purge", () => {
  assert(src.includes('parseHeldVmConfig(Deno.env.get("CLEANUP_HELD_VM_IDS"))'));
  // preview, idle, orphan, soft-expiry, stuck-provisioning, plus explicit 423 paths
  const hits = src.split("isHeldVm(").length - 1;
  assert(hits >= 6, `expected >= 6 held checks, got ${hits}`);
  assert(src.includes("isVmGuarded("));
  assert(src.includes("guardedDeleteBlock("));
  assert(src.includes("guardedLearnerLeaveBody()"));
  const leaveGuard = src.indexOf("Guarded leave: no session write");
  const leaveClose = src.indexOf('disconnect_reason: "learner_leave"');
  assert(leaveGuard > 0 && leaveClose > leaveGuard, "leave must guard before the session close");
  const warn = src.indexOf("Pre-expiry warning");
  const warnGuard = src.indexOf("isVmGuarded(vm)", warn);
  const warnedAt = src.indexOf("expiry_warned_at: now.toISOString()", warn);
  assert(warn > 0 && warnGuard > warn && warnedAt > warnGuard, "pre-expiry warning must skip guarded VMs");
  const idle = src.indexOf("Process idle sessions");
  const idleGuard = src.indexOf("session left open, not deallocated", idle);
  const idleClose = src.indexOf('disconnect_reason: "idle_timeout"', idle);
  assert(idle > 0 && idleGuard > idle && idleClose > idleGuard, "idle pass must guard before the session close");
  const stopBeforeClose = src.indexOf('action === "stop-vm" &&');
  const sharedClose = src.indexOf("Guarded delete and stop return 423 before any session close");
  const closeCall = src.indexOf('.update({ ended_at: new Date().toISOString(), status: "completed" })', sharedClose);
  assert(sharedClose > 0 && stopBeforeClose > sharedClose && closeCall > stopBeforeClose);
  const deleteGuard = src.indexOf("guardedDeleteBlock(");
  const adminDelete = src.indexOf('event: "vm_admin_delete"');
  assert(deleteGuard > 0 && adminDelete > deleteGuard, "delete-vm must 423 before the cloud delete");
  assert(src.slice(deleteGuard, adminDelete).includes("status: 423"));
  // purge-failed is stop-only: 410, no row delete
  assert(src.includes("TERMINATE_DISABLED"));
  assert(src.includes("status: 410"));
  assert(!src.includes('.from("virtual_machines").delete()'));
});

Deno.test("soft-expiry sweep honours SOFT_EXPIRY_MODE", () => {
  assert(src.includes('resolveSoftExpiryMode(Deno.env.get("SOFT_EXPIRY_MODE"))'));
  // Unknown values are reported, not silently enforced.
  assert(src.includes("mode_warning: softExpiryModeConfig.warning"));
  assert(src.includes("softExpiryEnforced(softExpiryMode, vm.status, decision)"));
  assert(src.includes('if (softExpiryMode === "off") throw new SkipSweep();'));
});

Deno.test("persistent Start clears a stale expires_at", () => {
  assert(src.includes("patch.expires_at = null;"));
});

Deno.test("idle / orphan stop failures are recorded on the VM row, with backoff + admin escalation", () => {
  assert(src.includes("await recordStopFailure("));
  assert(src.includes("isStopRetryDue(retry, vm.ended_at, nowMsForRetry)"));
  assert(src.includes('retry?.kind === "needs_admin"'));
  assert(src.includes('type: "vm_stop_failed"'));
  assert(src.includes("stop_retry: stopRetrySummary"));
});

Deno.test("SOFT_EXPIRY_MODE gates only the soft-expiry sweep (documented product decision)", () => {
  assert(src.includes("run in EVERY"));
  // The idle/orphan passes are not wrapped in a mode check.
  const orphanIdx = src.indexOf("// Process orphan VMs");
  const sweepIdx = src.indexOf('if (softExpiryMode === "off") throw new SkipSweep();');
  assert(orphanIdx > 0 && sweepIdx > orphanIdx);
  assert(!src.slice(0, sweepIdx).includes('softExpiryMode === "off"'));
});

Deno.test("unknown template persistence is surfaced, not silently enforced", () => {
  assert(src.includes("template_unknown_skipped"));
  assert(src.includes('event: "soft_expiry_template_lookup_failed"'));
});
