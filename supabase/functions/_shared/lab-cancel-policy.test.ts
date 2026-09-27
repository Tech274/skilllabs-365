import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideLearnerCancel } from "./lab-cancel-policy.ts";

Deno.test("admin cancel keeps hard-delete", () => {
  assertEquals(
    decideLearnerCancel({ isAdmin: true, status: "starting", completedSessions: 5 }),
    { mode: "delete", reason: "admin_cancel" },
  );
});

Deno.test("fresh learner provision can be deleted", () => {
  for (const status of ["provisioning", "running", "idle", "creating", null]) {
    assertEquals(
      decideLearnerCancel({ isAdmin: false, status, completedSessions: 0 }).mode,
      "delete",
      `status ${status}`,
    );
  }
});

Deno.test("resume (starting) is soft-stopped, never deleted", () => {
  assertEquals(
    decideLearnerCancel({ isAdmin: false, status: "Starting", completedSessions: 0 }),
    { mode: "soft_stop", reason: "resuming_existing_vm" },
  );
});

Deno.test("already deallocated/stopped is soft (no delete)", () => {
  for (const status of ["deallocated", "stopped"]) {
    assertEquals(
      decideLearnerCancel({ isAdmin: false, status, completedSessions: 0 }),
      { mode: "soft_stop", reason: "already_soft_stopped" },
    );
  }
});

Deno.test("previously used running VM is soft-stopped", () => {
  assertEquals(
    decideLearnerCancel({ isAdmin: false, status: "running", completedSessions: 2 }),
    { mode: "soft_stop", reason: "used_allocation" },
  );
});
