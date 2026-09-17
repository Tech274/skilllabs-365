import { describe, expect, it } from "vitest";
import { learnerFailureCopy } from "./learner-provisioning";

describe("learnerFailureCopy", () => {
  it("masks retry exhaustion calmly", () => {
    const copy = learnerFailureCopy("secure_desktop_retry_exhausted");
    expect(copy.title.toLowerCase()).toContain("paused");
    expect(copy.detail.toLowerCase()).not.toMatch(/guacamole|ssh|rdp|172\./);
  });

  it("masks frame timeout calmly", () => {
    const copy = learnerFailureCopy("secure_desktop_frame_timeout");
    expect(copy.detail.toLowerCase()).toContain("try again");
    expect(copy.detail.toLowerCase()).not.toMatch(/guacamole|websocket/);
  });
});
