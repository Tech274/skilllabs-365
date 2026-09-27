import { describe, expect, it } from "vitest";
import { isResumableStatus, needsRemint, shouldEndOnCountdown } from "@/lib/lab-remint";

describe("lab-remint helpers", () => {
  it("needsRemint covers powered-off and starting", () => {
    expect(needsRemint("deallocated")).toBe(true);
    expect(needsRemint("stopped")).toBe(true);
    expect(needsRemint("starting")).toBe(true);
    expect(needsRemint("running")).toBe(false);
  });

  it("isResumableStatus only when Start should call start-vm", () => {
    expect(isResumableStatus("deallocated")).toBe(true);
    expect(isResumableStatus("stopped")).toBe(true);
    expect(isResumableStatus("starting")).toBe(false);
    expect(isResumableStatus("running")).toBe(false);
  });

  it("shouldEndOnCountdown never ends on a stale pre-remint expires_at (SCRUM-21)", () => {
    // Remint in flight or machine still powered off / waking: keep going.
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: true, vmStatus: "running" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "deallocated" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "starting" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "stopped" })).toBe(false);
  });

  it("shouldEndOnCountdown ends only on a trusted expiry of a running lab", () => {
    expect(shouldEndOnCountdown({ remainingMs: 0, reminting: false, vmStatus: "running" })).toBe(true);
    expect(shouldEndOnCountdown({ remainingMs: -1, reminting: false, vmStatus: "idle" })).toBe(true);
    expect(shouldEndOnCountdown({ remainingMs: 5_000, reminting: false, vmStatus: "running" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: Number.NaN, reminting: false, vmStatus: "running" })).toBe(false);
  });
});
