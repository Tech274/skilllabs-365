import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideSoftExpiry,
  expiresAtSkippedReason,
  guardedDeleteBlock,
  guardedLearnerLeaveBody,
  isHeldVm,
  isVmGuarded,
  isSoftExpiryStatus,
  parseHeldVmConfig,
  parseHeldVmList,
  parseSoftExpiryMode,
  resolveSoftExpiryMode,
  softExpiryEnforced,
  softExpiryNotice,
  ORPHAN_SWEEP_STATUSES,
} from "./lab-expiry.ts";

// 28 Sep 2026 00:30 IST — half an hour past a 27 Sep end date.
const AFTER_END = Date.parse("2026-09-27T19:00:00Z");
// 27 Sep 2026 23:00 IST — still inside the 27 Sep end date.
const BEFORE_END = Date.parse("2026-09-27T17:30:00Z");
const END_27_SEP = "2026-09-27T18:29:59.999Z"; // stored as EOD IST

const persistent = { name: "AWS Win", duration: 600, is_persistent: true, end_date: END_27_SEP };

Deno.test("idle and OS-stopped VMs are swept (compute may still bill)", () => {
  assertEquals(isSoftExpiryStatus("idle"), true);
  assertEquals(isSoftExpiryStatus("stopped"), true);
  assertEquals(isSoftExpiryStatus("RUNNING"), true);
  assertEquals((ORPHAN_SWEEP_STATUSES as readonly string[]).includes("idle"), true);
});

Deno.test("held / terminal VMs are never touched", () => {
  for (const status of ["deallocated", "terminated", "failed", "expired", null, undefined, ""]) {
    assertEquals(
      decideSoftExpiry({ status, expiresAt: "2020-01-01T00:00:00Z", template: persistent, nowMs: AFTER_END }),
      null,
    );
  }
});

Deno.test("expires_at in the past → lab_window_expired (idle included)", () => {
  const d = decideSoftExpiry({
    status: "idle",
    expiresAt: "2026-09-27T18:00:00Z",
    template: { duration: 60, is_persistent: false },
    nowMs: AFTER_END,
  });
  assertEquals(d, { reason: "lab_window_expired", trigger: "expires_at" });
});

Deno.test("persistent end date passed (EOD IST) → lab_window_expired", () => {
  const d = decideSoftExpiry({ status: "running", template: persistent, sessions: [], nowMs: AFTER_END });
  assertEquals(d?.reason, "lab_window_expired");
  assertEquals(d?.trigger, "template_end_date");
});

Deno.test("persistent end date still today in IST → keep running", () => {
  assertEquals(decideSoftExpiry({ status: "running", template: persistent, sessions: [], nowMs: BEFORE_END }), null);
});

Deno.test("stale end_date on a non-persistent template matches the Start gate (ignored)", () => {
  const tpl = { duration: 600, is_persistent: false, end_date: END_27_SEP };
  assertEquals(decideSoftExpiry({ status: "running", template: tpl, sessions: [], nowMs: AFTER_END }), null);
});

Deno.test("minutes used up → lab_minutes_exhausted", () => {
  const d = decideSoftExpiry({
    status: "running",
    template: { duration: 60, is_persistent: false },
    sessions: [{ started_at: "2026-09-27T16:00:00Z", ended_at: null }],
    nowMs: BEFORE_END,
  });
  assertEquals(d?.reason, "lab_minutes_exhausted");
  assertEquals(d?.usedMinutes, 90);
  assertEquals(d?.allocatedMinutes, 60);
});

Deno.test("zero-minute template never counts as exhausted", () => {
  const d = decideSoftExpiry({
    status: "running",
    template: { duration: 0, is_persistent: false },
    sessions: [{ started_at: "2026-09-27T10:00:00Z", ended_at: null }],
    nowMs: BEFORE_END,
  });
  assertEquals(d, null);
});

Deno.test("expires_at wins over wallet triggers; future expires_at falls through", () => {
  const nonPersistent = { duration: 60, is_persistent: false };
  const past = decideSoftExpiry({
    status: "running",
    expiresAt: "2026-09-27T18:00:00Z",
    template: nonPersistent,
    sessions: [{ started_at: "2026-09-27T16:00:00Z", ended_at: null }],
    nowMs: AFTER_END,
  });
  assertEquals(past?.trigger, "expires_at");
  const future = decideSoftExpiry({
    status: "running",
    expiresAt: "2026-09-30T00:00:00Z",
    template: persistent,
    nowMs: AFTER_END,
  });
  assertEquals(future?.trigger, "template_end_date");
});

Deno.test("invalid expires_at is ignored", () => {
  assertEquals(decideSoftExpiry({ status: "running", expiresAt: "not-a-date", nowMs: AFTER_END }), null);
});

Deno.test("notice copy per trigger", () => {
  assertEquals(softExpiryNotice({ reason: "lab_window_expired", trigger: "expires_at" }, "vm-1").type, "lab_expired");
  assertEquals(
    softExpiryNotice({ reason: "lab_window_expired", trigger: "template_end_date" }, "vm-1", "AWS Win").title,
    "Lab window ended — VM deallocated",
  );
  const m = softExpiryNotice(
    { reason: "lab_minutes_exhausted", trigger: "minutes_exhausted", allocatedMinutes: 60, usedMinutes: 61 },
    "vm-1",
  );
  assertEquals(m.type, "lab_minutes_exhausted");
  assertEquals(m.message.includes("60 allocated minutes"), true);
});

// ---- Review follow-up (Atlas) ----------------------------------------------

Deno.test("persistent lab: stale expires_at never deallocates a freshly started VM", () => {
  const open = { ...persistent, end_date: "2026-12-31" };
  assertEquals(
    decideSoftExpiry({ status: "starting", expiresAt: "2026-01-01T00:00:00Z", template: open, sessions: [], nowMs: AFTER_END }),
    null,
  );
  // ...but its end date still applies.
  assertEquals(
    decideSoftExpiry({ status: "running", expiresAt: "2026-01-01T00:00:00Z", template: persistent, sessions: [], nowMs: AFTER_END })?.trigger,
    "template_end_date",
  );
});

Deno.test("SOFT_EXPIRY_MODE parsing defaults to legacy", () => {
  assertEquals(parseSoftExpiryMode(undefined), "legacy");
  assertEquals(parseSoftExpiryMode(""), "legacy");
  assertEquals(parseSoftExpiryMode("ENFORCE"), "enforce");
  assertEquals(parseSoftExpiryMode("dry-run"), "dry-run");
  assertEquals(parseSoftExpiryMode("off"), "off");
  assertEquals(parseSoftExpiryMode(" legacy "), "legacy");
  assertEquals(parseSoftExpiryMode("   "), "legacy");
});

Deno.test("unknown / typo SOFT_EXPIRY_MODE fails SAFE to dry-run with a warning (Riley #54)", () => {
  for (const typo of ["dry_run", "dryrun", "disabled", "false", "yes", "Enforced"]) {
    const cfg = resolveSoftExpiryMode(typo);
    assertEquals(cfg.mode, "dry-run", typo);
    assertEquals(cfg.configured, typo);
    assertEquals(typeof cfg.warning === "string" && cfg.warning.includes(typo), true);
    // dry-run never enforces anything.
    assertEquals(
      softExpiryEnforced(cfg.mode, "running", { reason: "lab_window_expired", trigger: "expires_at" }),
      false,
    );
  }
  // Unset keeps legacy (backward compatible) with no warning.
  assertEquals(resolveSoftExpiryMode(undefined), { mode: "legacy", configured: null, warning: null });
  assertEquals(resolveSoftExpiryMode("ENFORCE").warning, null);
});

Deno.test("legacy mode enforces only the pre-SCRUM-28 scope", () => {
  const exp = { reason: "lab_window_expired", trigger: "expires_at" } as const;
  const win = { reason: "lab_window_expired", trigger: "template_end_date" } as const;
  assertEquals(softExpiryEnforced("legacy", "running", exp), true);
  assertEquals(softExpiryEnforced("legacy", "idle", exp), false);
  assertEquals(softExpiryEnforced("legacy", "stopped", exp), false);
  assertEquals(softExpiryEnforced("legacy", "idle", win), true);
  assertEquals(softExpiryEnforced("legacy", "stopped", win), false);
  assertEquals(softExpiryEnforced("enforce", "stopped", win), true);
  assertEquals(softExpiryEnforced("dry-run", "running", exp), false);
  assertEquals(softExpiryEnforced("off", "running", exp), false);
});

Deno.test("held list: smoke VM built in, extra ids from secret, prefix and instance-id match", () => {
  const held = parseHeldVmList(" i-0guachost01 , 11111111-2222-3333-4444-555555555555 ,,");
  assertEquals(held.includes("bba27e8f"), true);
  assertEquals(isHeldVm({ id: "bba27e8f-aaaa-bbbb-cccc-dddddddddddd", azure_vm_id: "i-0abc" }, held), true);
  assertEquals(isHeldVm({ id: "x", azure_vm_id: "i-0GUACHOST01" }, held), true);
  assertEquals(isHeldVm({ id: "11111111-2222-3333-4444-555555555555" }, held), true);
  assertEquals(
    isHeldVm({ id: "y", azure_vm_id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/i-0guachost01" }, held),
    true,
  );
  assertEquals(isHeldVm({ id: "cafebabe-0000-0000-0000-000000000000", azure_vm_id: "i-0other" }, held), false);
  // Short fragments never prefix-match.
  assertEquals(isHeldVm({ id: "abc12345-0000" }, parseHeldVmList("abc")), false);
});

// ---- Riley re-check of #54 -------------------------------------------------

Deno.test("unknown persistence (no template / lookup failed) is cautious: expires_at alone never stops it", () => {
  for (const template of [null, undefined, { name: "x" }]) {
    assertEquals(
      decideSoftExpiry({ status: "running", expiresAt: "2026-01-01T00:00:00Z", template, nowMs: AFTER_END }),
      null,
    );
    assertEquals(
      expiresAtSkippedReason({ status: "running", expiresAt: "2026-01-01T00:00:00Z", template, nowMs: AFTER_END }),
      "template_unknown",
    );
  }
  assertEquals(
    expiresAtSkippedReason({ status: "running", expiresAt: "2026-01-01T00:00:00Z", template: persistent, nowMs: AFTER_END }),
    "persistent",
  );
  // Known non-persistent: not skipped (the trigger fires).
  assertEquals(
    expiresAtSkippedReason({
      status: "running", expiresAt: "2026-01-01T00:00:00Z", template: { is_persistent: false }, nowMs: AFTER_END,
    }),
    null,
  );
  // Future / unset expires_at or a held status: nothing to report.
  assertEquals(expiresAtSkippedReason({ status: "running", expiresAt: "2027-01-01T00:00:00Z", template: null, nowMs: AFTER_END }), null);
  assertEquals(expiresAtSkippedReason({ status: "deallocated", expiresAt: "2026-01-01T00:00:00Z", template: null, nowMs: AFTER_END }), null);
});

Deno.test("held list matches full Hub id, cloud instance id and VM name", () => {
  const hubId = "0f6c2a7e-1d2b-4c3d-8e9f-a0b1c2d3e4f5";
  const armId = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/lab-3f2a1b9c-mf3k2";
  const held = parseHeldVmList(`${hubId}, i-0123456789abcdef0, LAB-3F2A1B9C-MF3K2`);
  // Full Hub row id.
  assertEquals(isHeldVm({ id: hubId.toUpperCase(), azure_vm_id: null }, held), true);
  // AWS instance id (exact).
  assertEquals(isHeldVm({ id: "other", azure_vm_id: "i-0123456789abcdef0" }, held), true);
  // Azure VM name = last ARM segment (case-insensitive, trailing slash tolerated).
  assertEquals(isHeldVm({ id: "other", azure_vm_id: armId }, held), true);
  assertEquals(isHeldVm({ id: "other", azure_vm_id: `${armId}/` }, held), true);
  // Full ARM id as the entry also works.
  assertEquals(isHeldVm({ id: "other", azure_vm_id: armId }, parseHeldVmList(armId)), true);
  // A cloud-name fragment never prefix-matches (cannot hold a whole template's fleet).
  assertEquals(isHeldVm({ id: "other", azure_vm_id: armId }, parseHeldVmList("lab-3f2a1b9c")), false);
  assertEquals(isHeldVm({ id: "other", azure_vm_id: "i-0123456789abcdef1" }, held), false);
});

Deno.test("built-in smoke hold bba27e8f matches the Hub short id, also when copied with an ellipsis", () => {
  const held = parseHeldVmList(undefined);
  assertEquals(isHeldVm({ id: "bba27e8f-1111-2222-3333-444455556666", azure_vm_id: "i-0aaaaaaaaaaaaaaaa" }, held), true);
  assertEquals(isHeldVm({ id: "cafe0000-1111-2222-3333-444455556666", azure_vm_id: "i-0aaaaaaaaaaaaaaaa" }, held), false);
  assertEquals(isHeldVm({ id: "0f6c2a7e-1d2b-4c3d-8e9f-a0b1c2d3e4f5" }, parseHeldVmList("0f6c2a7e…")), true);
  assertEquals(isHeldVm({ id: "0f6c2a7e-1d2b-4c3d-8e9f-a0b1c2d3e4f5" }, parseHeldVmList("0f6c2a7e...")), true);
});

Deno.test("short held entries are reported, not silently ignored", () => {
  const cfg = parseHeldVmConfig("abc123, 0f6c2a7e, i-0123456789abcdef0");
  assertEquals(cfg.warnings.length, 1);
  assertEquals(cfg.warnings[0].includes("abc123"), true);
  assertEquals(parseHeldVmConfig(undefined).warnings, []);
});

const HUB = "11111111-2222-3333-4444-555555555555";
const ARM = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/lab-3f2a1b9c";

Deno.test("union guard: protected by either list stays protected", () => {
  const lists = {
    protectedEntries: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    heldEntries: ["bba27e8f", HUB],
  };
  assertEquals(isVmGuarded({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, lists), true);
  assertEquals(isVmGuarded({ id: HUB }, lists), true);
  assertEquals(isVmGuarded({ id: "cafebabe-0000-0000-0000-000000000000" }, lists), false);
});

Deno.test("union guard: prefix, cloud id and Azure name apply to BOTH lists", () => {
  const fromProtected = {
    protectedEntries: ["abc12345", "i-0123456789abcdef0", "lab-3f2a1b9c"],
    heldEntries: ["bba27e8f"],
  };
  assertEquals(
    isVmGuarded({ id: "abc12345-1111-2222-3333-444455556666", azure_vm_id: "other" }, fromProtected),
    true,
  );
  assertEquals(
    isVmGuarded({ id: "other", azure_vm_id: "i-0123456789abcdef0" }, fromProtected),
    true,
  );
  assertEquals(
    isVmGuarded({ id: "other", azure_vm_id: ARM }, fromProtected),
    true,
  );
  const fromHeld = {
    protectedEntries: [] as string[],
    heldEntries: ["bba27e8f", "def98765", "i-0abc", "lab-heldname"],
  };
  assertEquals(isVmGuarded({ id: "def98765-0000-0000-0000-000000000000" }, fromHeld), true);
  assertEquals(isVmGuarded({ id: "x", azure_vm_id: "i-0abc" }, fromHeld), true);
  assertEquals(
    isVmGuarded({
      id: "x",
      azure_vm_id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/lab-heldname",
    }, fromHeld),
    true,
  );
});

Deno.test("union guard: built-in smoke prefix bba27e8f stays protected with empty secrets", () => {
  const lists = { protectedEntries: [] as string[], heldEntries: parseHeldVmList(undefined) };
  assertEquals(
    isVmGuarded({ id: "bba27e8f-1111-2222-3333-444455556666", azure_vm_id: "i-0other" }, lists),
    true,
  );
  assertEquals(isVmGuarded({ id: "cafe0000-1111-2222-3333-444455556666" }, lists), false);
});

Deno.test("delete-vm: a VM guarded by either list is 423, with no admin bypass", () => {
  const empty = { protectedEntries: [] as string[], heldEntries: parseHeldVmList(undefined) };
  const builtin = guardedDeleteBlock(
    { id: "bba27e8f-1111-2222-3333-444455556666", azure_vm_id: "i-0other" },
    empty,
  );
  assertEquals(builtin?.error, "VM_PROTECTED");
  assertEquals(builtin?.code, "VM_PROTECTED");
  assertEquals(builtin?.vm_id, "bba27e8f-1111-2222-3333-444455556666");

  const fromProtected = {
    protectedEntries: ["abc12345", "i-0123456789abcdef0", "lab-3f2a1b9c"],
    heldEntries: ["bba27e8f"],
  };
  assertEquals(
    guardedDeleteBlock({ id: "abc12345-1111-2222-3333-444455556666" }, fromProtected)?.code,
    "VM_PROTECTED",
  );
  assertEquals(
    guardedDeleteBlock({ id: "other", azure_vm_id: "i-0123456789abcdef0" }, fromProtected)?.code,
    "VM_PROTECTED",
  );
  assertEquals(
    guardedDeleteBlock({ id: "other", azure_vm_id: ARM }, fromProtected)?.code,
    "VM_PROTECTED",
  );

  const fromHeld = {
    protectedEntries: [] as string[],
    heldEntries: ["bba27e8f", "def98765", "i-0held", "lab-heldname"],
  };
  assertEquals(
    guardedDeleteBlock({ id: "def98765-0000-0000-0000-000000000000" }, fromHeld)?.code,
    "VM_PROTECTED",
  );
  assertEquals(guardedDeleteBlock({ id: "x", azure_vm_id: "i-0held" }, fromHeld)?.code, "VM_PROTECTED");
  assertEquals(
    guardedDeleteBlock({
      id: "x",
      azure_vm_id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/lab-heldname",
    }, fromHeld)?.code,
    "VM_PROTECTED",
  );

  // The helper has no admin flag. An unguarded VM is the only delete that proceeds.
  assertEquals(guardedDeleteBlock({ id: "cafe0000-1111-2222-3333-444455556666" }, empty), null);
});

Deno.test("learner-leave 423 says the session closed and the protected VM kept running", () => {
  assertEquals(guardedLearnerLeaveBody(), {
    error: "VM_PROTECTED",
    code: "VM_PROTECTED",
    session_closed: true,
    vm_kept_running: true,
    message: "Session closed; VM kept running because it is protected.",
  });
});

Deno.test("SOFT_EXPIRY_MODE=dry-run never authorises a cloud stop", () => {
  const decision = { reason: "lab_window_expired", trigger: "expires_at" } as const;
  for (const status of ["running", "provisioning", "starting", "idle", "stopped"]) {
    assertEquals(softExpiryEnforced("dry-run", status, decision), false);
  }
});
