import { describe, expect, it } from "vitest";
import { cancelToastCopy, parseCancelResponse } from "@/lib/cancel-outcome";

describe("parseCancelResponse (SCRUM-106)", () => {
  it("treats a soft-stop response as kept", () => {
    const o = parseCancelResponse("vm1", "lab1", {
      action: "cancel-soft-stopped",
      deleted: false,
      status: "deallocated",
    });
    expect(o).toEqual({ vmId: "vm1", labId: "lab1", deleted: false, status: "deallocated" });
    expect(cancelToastCopy(o).title).toBe("Lab paused");
  });

  it("treats deleted:true and legacy cancelled responses as removed", () => {
    expect(parseCancelResponse("vm1", null, { action: "cancelled", deleted: true }).deleted).toBe(true);
    expect(parseCancelResponse("vm1", null, { action: "cancelled" }).deleted).toBe(true);
    expect(cancelToastCopy(parseCancelResponse("vm1", null, { action: "cancelled" })).title).toBe(
      "Provisioning Cancelled",
    );
  });

  it("kept but cloud stop still pending never claims deletion", () => {
    const o = parseCancelResponse("vm1", "lab1", { deleted: false, status: "starting" });
    expect(o.deleted).toBe(false);
    expect(cancelToastCopy(o).description).toMatch(/NOT deleted/);
  });
});
