import { describe, expect, it } from "vitest";
import { isPendingCancelStop, parseStopRetry, stopRetryBadge } from "@/lib/stop-retry";

describe("stop-retry markers (SPA mirror)", () => {
  it("parses the same markers as the edge function", () => {
    expect(parseStopRetry("learner_cancel_pending_stop")).toEqual({ kind: "cancel", attempts: 0 });
    expect(parseStopRetry("cleanup_stop_retry:3")).toEqual({ kind: "cleanup", attempts: 3 });
    expect(parseStopRetry("stop_failed_needs_admin:6")).toEqual({ kind: "needs_admin", attempts: 6 });
    expect(parseStopRetry("idle_timeout")).toBeNull();
  });

  it("dashboard treats a pending Cancel stop on a live VM as Pausing", () => {
    expect(isPendingCancelStop("starting", "learner_cancel_pending_stop")).toBe(true);
    expect(isPendingCancelStop("running", "learner_cancel_pending_stop:2")).toBe(true);
    expect(isPendingCancelStop("deallocated", "learner_cancel_pending_stop")).toBe(false);
    expect(isPendingCancelStop("running", "cleanup_stop_retry:1")).toBe(false);
    expect(isPendingCancelStop("starting", null)).toBe(false);
  });

  it("admin badge: warning while retrying, destructive once given up", () => {
    expect(stopRetryBadge("cleanup_stop_retry:2")?.tone).toBe("warning");
    expect(stopRetryBadge("stop_failed_needs_admin:6")?.tone).toBe("destructive");
    expect(stopRetryBadge("stop_failed_needs_admin:6")?.label).toMatch(/needs admin/);
    expect(stopRetryBadge(null)).toBeNull();
  });
});
