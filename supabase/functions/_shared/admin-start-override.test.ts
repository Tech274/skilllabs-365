import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adminRestartOutcome, adminStartOverrideMessage } from "./admin-start-override.ts";

Deno.test("no start sent while starting or provisioning is already_starting", () => {
  assertEquals(adminRestartOutcome(false, "starting"), "already_starting");
  assertEquals(adminRestartOutcome(false, "STARTING"), "already_starting");
  assertEquals(adminRestartOutcome(false, "provisioning"), "already_starting");
  assertEquals(
    adminStartOverrideMessage("already_starting"),
    "Admin Start found the VM already starting. Minutes were not deducted.",
  );
});

Deno.test("no start sent while running or idle stays already_running", () => {
  assertEquals(adminRestartOutcome(false, "running"), "already_running");
  assertEquals(adminRestartOutcome(false, "idle"), "already_running");
  assertEquals(
    adminStartOverrideMessage("already_running"),
    "Admin Start found the VM already running. Minutes were not deducted.",
  );
});

Deno.test("a start that was sent records running or start_accepted", () => {
  assertEquals(adminRestartOutcome(true, "running"), "running");
  assertEquals(adminRestartOutcome(true, "idle"), "running");
  assertEquals(adminRestartOutcome(true, "starting"), "start_accepted");
  assertEquals(
    adminStartOverrideMessage("start_accepted"),
    "Admin Start was accepted; the VM is still starting. Minutes were not deducted.",
  );
  assertEquals(
    adminStartOverrideMessage("running"),
    "Admin Start powered the VM on. Minutes were not deducted.",
  );
  assertEquals(
    adminStartOverrideMessage("failed", "REMINT_START_FAILED"),
    "Admin Start did not power the VM on (REMINT_START_FAILED). Minutes were not deducted.",
  );
});
