import { describe, expect, it } from "vitest";
import { learnerLeaveNotice } from "@/lib/learner-leave";
import { shouldRunClientWalletPrecheck } from "@/lib/lab-wallet";

describe("learner leave notice", () => {
  it("treats a protected VM as a successful leave, not a failure", () => {
    const notice = learnerLeaveNotice({
      success: true,
      kept_running: true,
      reason: "VM_PROTECTED",
    });
    expect(notice.title).toBe("Left the lab");
    expect(notice.description).toContain("left running");
    expect(notice.description.toLowerCase()).not.toContain("leave failed");
    expect(notice.description.toLowerCase()).not.toContain("session closed");
  });

  it("keeps the wallet equation when the machine was soft-stopped", () => {
    const notice = learnerLeaveNotice({
      success: true,
      wallet: { allocated_minutes: 1200, used_minutes: 40, remaining_minutes: 1160 },
    });
    expect(notice.description).toContain("1200 − 40 = 1160");
    expect(notice.description).toContain("not deleted");
  });
});

describe("admin Start client wallet pre-check", () => {
  it("does not block the admin override path", () => {
    expect(shouldRunClientWalletPrecheck(true)).toBe(false);
  });

  it("still runs for a learner", () => {
    expect(shouldRunClientWalletPrecheck(false)).toBe(true);
  });
});
