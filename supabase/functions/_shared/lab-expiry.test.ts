import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideSoftExpiry,
  isSoftExpiryStatus,
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
    template: null,
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
  const past = decideSoftExpiry({
    status: "running",
    expiresAt: "2026-09-27T18:00:00Z",
    template: persistent,
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
