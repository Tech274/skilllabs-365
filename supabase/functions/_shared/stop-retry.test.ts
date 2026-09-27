import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANCEL_PENDING_STOP_REASON,
  effectiveStopRetry,
  formatStopRetry,
  isLearnerResumablePendingStop,
  isStopRetryDue,
  nextStopRetryAfterFailure,
  parseStopRetry,
  stopRetryBackoffMinutes,
  STOP_RETRY_MAX_ATTEMPTS,
  type StopRetryState,
} from "./stop-retry.ts";

const T0 = Date.parse("2026-09-28T00:00:00Z");
const min = (m: number) => new Date(T0 + m * 60_000).toISOString();

Deno.test("markers round-trip; the #58 marker is attempt 0 (backward compatible)", () => {
  assertEquals(parseStopRetry(CANCEL_PENDING_STOP_REASON), { kind: "cancel", attempts: 0 });
  assertEquals(parseStopRetry("learner_cancel_pending_stop:3"), { kind: "cancel", attempts: 3 });
  assertEquals(parseStopRetry("cleanup_stop_retry:2"), { kind: "cleanup", attempts: 2 });
  assertEquals(parseStopRetry("stop_failed_needs_admin:6"), { kind: "needs_admin", attempts: 6 });
  for (const other of [null, "", "idle_timeout", "learner_cancel_kept", "orphan_no_session"]) {
    assertEquals(parseStopRetry(other), null);
  }
  assertEquals(formatStopRetry({ kind: "cancel", attempts: 0 }), CANCEL_PENDING_STOP_REASON);
  assertEquals(formatStopRetry({ kind: "cleanup", attempts: 4 }), "cleanup_stop_retry:4");
});

Deno.test("backoff doubles from 5 min and caps at 60", () => {
  assertEquals([1, 2, 3, 4, 5, 6, 9].map(stopRetryBackoffMinutes), [5, 10, 20, 40, 60, 60, 60]);
});

Deno.test("due: first attempt now, then only after the backoff, never for needs_admin", () => {
  assertEquals(isStopRetryDue(null, null, T0), true);
  assertEquals(isStopRetryDue({ kind: "cancel", attempts: 0 }, min(0), T0), true);
  const two: StopRetryState = { kind: "cleanup", attempts: 2 };
  assertEquals(isStopRetryDue(two, min(-9), T0), false);
  assertEquals(isStopRetryDue(two, min(-10), T0), true);
  assertEquals(isStopRetryDue({ kind: "needs_admin", attempts: 6 }, min(-10_000), T0), false);
});

Deno.test("a permanently failing stop escalates to needs_admin after N attempts, exactly once", () => {
  let state: StopRetryState | null = { kind: "cancel", attempts: 0 };
  let escalations = 0;
  for (let i = 0; i < STOP_RETRY_MAX_ATTEMPTS + 3; i++) {
    const next = nextStopRetryAfterFailure(state, "cancel");
    if (next.escalated) escalations += 1;
    state = next.state;
  }
  assertEquals(escalations, 1);
  assertEquals(state?.kind, "needs_admin");
  // Idle/orphan failures start a cleanup counter.
  assertEquals(nextStopRetryAfterFailure(null, "cleanup").state, { kind: "cleanup", attempts: 1 });
});

Deno.test("total time to escalation stays bounded (~2-3 h at a 5-min cron)", () => {
  let total = 0;
  for (let n = 1; n < STOP_RETRY_MAX_ATTEMPTS; n++) total += stopRetryBackoffMinutes(n);
  assertEquals(total <= 180, true);
});

Deno.test("stale cleanup markers reset; cancel and needs_admin never go stale", () => {
  const old = new Date(T0 - 25 * 3600_000).toISOString();
  assertEquals(effectiveStopRetry("cleanup_stop_retry:5", old, T0), null);
  assertEquals(effectiveStopRetry("cleanup_stop_retry:5", min(-30), T0), { kind: "cleanup", attempts: 5 });
  assertEquals(effectiveStopRetry("learner_cancel_pending_stop:2", old, T0), { kind: "cancel", attempts: 2 });
  assertEquals(effectiveStopRetry("stop_failed_needs_admin:6", old, T0)?.kind, "needs_admin");
});

Deno.test("learner Start may take back a pending Cancel stop, but not clear an idle/orphan admin flag", () => {
  assertEquals(isLearnerResumablePendingStop("starting", CANCEL_PENDING_STOP_REASON), true);
  assertEquals(isLearnerResumablePendingStop("running", "learner_cancel_pending_stop:2"), true);
  assertEquals(isLearnerResumablePendingStop("starting", "stop_failed_needs_admin:6"), true);
  assertEquals(isLearnerResumablePendingStop("running", "stop_failed_needs_admin:6"), false);
  assertEquals(isLearnerResumablePendingStop("running", "cleanup_stop_retry:1"), false);
  assertEquals(isLearnerResumablePendingStop("deallocated", CANCEL_PENDING_STOP_REASON), false);
  assertEquals(isLearnerResumablePendingStop("starting", null), false);
});
