import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Review follow-up (SCRUM-28): source-level guards for the auto-cleanup passes.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("idle / orphan cloud errors are isolated per VM (run never aborts)", () => {
  assert(src.includes('event: "idle_deallocate_failed"'));
  assert(src.includes('event: "orphan_deallocate_failed"'));
});

Deno.test("held VMs are skipped by every automatic pass and purge", () => {
  assert(src.includes('parseHeldVmList(Deno.env.get("CLEANUP_HELD_VM_IDS"))'));
  // purge, idle, orphan, soft-expiry, stuck-provisioning, preview
  const hits = src.split("isHeldVm(").length - 1;
  assert(hits >= 6, `expected >= 6 held checks, got ${hits}`);
});

Deno.test("soft-expiry sweep honours SOFT_EXPIRY_MODE", () => {
  assert(src.includes('parseSoftExpiryMode(Deno.env.get("SOFT_EXPIRY_MODE"))'));
  assert(src.includes("softExpiryEnforced(softExpiryMode, vm.status, decision)"));
  assert(src.includes('if (softExpiryMode === "off") throw new SkipSweep();'));
});

Deno.test("persistent Start clears a stale expires_at", () => {
  assert(src.includes("expiresPatch.expires_at = null;"));
});
