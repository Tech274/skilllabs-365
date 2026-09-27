import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideLearnerCancel } from "./lab-cancel-policy.ts";

const learner = { isAdmin: false, priorSessions: 0 };

Deno.test("service-role (operator retry) and explicit admin force_delete keep hard-delete", () => {
  assertEquals(
    decideLearnerCancel({ ...learner, isServiceRole: true, status: "starting", priorSessions: 5 }),
    { mode: "delete", reason: "admin_cancel" },
  );
  assertEquals(
    decideLearnerCancel({ isAdmin: true, forceDelete: true, status: "running", priorSessions: 5, isPersistent: true }).mode,
    "delete",
  );
});

Deno.test("admin clicking the learner panel Cancel does NOT hard-delete a resumed/used VM", () => {
  assertEquals(decideLearnerCancel({ isAdmin: true, status: "starting", priorSessions: 0 }).mode, "soft_stop");
  assertEquals(decideLearnerCancel({ isAdmin: true, status: "running", priorSessions: 2, isPersistent: false }).mode, "soft_stop");
});

Deno.test("fresh non-persistent provision with no session can be deleted", () => {
  for (const status of ["provisioning", "running", "idle", "creating", null]) {
    assertEquals(decideLearnerCancel({ ...learner, status, isPersistent: false }).mode, "delete", `status ${status}`);
  }
});

Deno.test("fresh persistent provision is deletable only while still provisioning", () => {
  assertEquals(decideLearnerCancel({ ...learner, status: "provisioning", isPersistent: true }).mode, "delete");
  assertEquals(
    decideLearnerCancel({ ...learner, status: "running", isPersistent: true }),
    { mode: "soft_stop", reason: "persistent_mid_window" },
  );
  // Unknown persistence (template lookup failed) is treated as persistent.
  assertEquals(decideLearnerCancel({ ...learner, status: "running", isPersistent: null }).mode, "soft_stop");
});

Deno.test("first, still-ACTIVE session counts as use (was deleted before the follow-up)", () => {
  assertEquals(
    decideLearnerCancel({ ...learner, status: "running", priorSessions: 1, isPersistent: false }),
    { mode: "soft_stop", reason: "used_allocation" },
  );
});

Deno.test("resume (starting) is soft-stopped, never deleted", () => {
  assertEquals(
    decideLearnerCancel({ ...learner, status: "Starting", isPersistent: false }),
    { mode: "soft_stop", reason: "resuming_existing_vm" },
  );
});

Deno.test("already deallocated/stopped is soft (no delete)", () => {
  for (const status of ["deallocated", "stopped"]) {
    assertEquals(
      decideLearnerCancel({ ...learner, status, isPersistent: false }),
      { mode: "soft_stop", reason: "already_soft_stopped" },
    );
  }
});
