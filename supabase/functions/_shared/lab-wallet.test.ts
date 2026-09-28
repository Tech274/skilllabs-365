import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adminPersistentRemintSkipsOwnerWallet,
  buildWalletSnapshot,
  persistentStartClearsExpiresAt,
  usedMinutesFromSessions,
  walletBlockMessage,
  LAB_MINUTES_EXHAUSTED,
} from "./lab-wallet.ts";

const NOW = Date.parse("2026-09-19T12:00:00Z");

Deno.test("used minutes round from open→leave interval", () => {
  const used = usedMinutesFromSessions(
    [{ started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T10:40:00Z" }],
    NOW,
  );
  assertEquals(used, 40);
});

Deno.test("wallet 1200 − 40 = 1160 and Start allowed", () => {
  const snap = buildWalletSnapshot({
    duration: 1200,
    isPersistent: true,
    endDate: "2026-12-31T00:00:00Z",
    sessions: [{ started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T10:40:00Z" }],
    nowMs: NOW,
  });
  assertEquals(snap.allocatedMinutes, 1200);
  assertEquals(snap.usedMinutes, 40);
  assertEquals(snap.remainingMinutes, 1160);
  assertEquals(snap.exhausted, false);
  assertEquals(walletBlockMessage(snap), null);
});

Deno.test("exhausted minutes block Start without implying delete", () => {
  const snap = buildWalletSnapshot({
    duration: 40,
    isPersistent: true,
    endDate: "2026-12-31T00:00:00Z",
    sessions: [{ started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T10:40:00Z" }],
    nowMs: NOW,
  });
  assertEquals(snap.exhausted, true);
  const blocked = walletBlockMessage(snap);
  assertEquals(blocked?.code, LAB_MINUTES_EXHAUSTED);
  if (!blocked?.error.includes("not deleted")) {
    throw new Error(`expected not-deleted copy, got: ${blocked?.error}`);
  }
});

Deno.test("admin persistent remint skips the owner wallet; learner remint does not", () => {
  assertEquals(adminPersistentRemintSkipsOwnerWallet(true, true, true), true);
  assertEquals(adminPersistentRemintSkipsOwnerWallet(false, true, true), false);
  assertEquals(adminPersistentRemintSkipsOwnerWallet(true, false, true), false);
  assertEquals(adminPersistentRemintSkipsOwnerWallet(true, true, false), false);
});

Deno.test("persistent Start clears expires_at; non-persistent does not", () => {
  assertEquals(persistentStartClearsExpiresAt(true), { expires_at: null });
  assertEquals(persistentStartClearsExpiresAt(false), {});
});
