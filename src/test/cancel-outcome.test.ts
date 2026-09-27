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

describe("Cancel while the VM is still powering on (Riley #58)", () => {
  it("card shows Pausing, not Starting, and the toast agrees", async () => {
    const { cardStatusAfterCancel, PAUSING_CARD_STATUS } = await import("@/lib/cancel-outcome");
    const o = parseCancelResponse("vm1", "lab1", { action: "cancel-soft-stopped", deleted: false, status: "starting", cloud_stop_ok: false });
    expect(cardStatusAfterCancel(o)).toBe(PAUSING_CARD_STATUS);
    const copy = cancelToastCopy(o);
    expect(copy.title).toBe("Pausing lab");
    expect(copy.description).toMatch(/pause automatically/);
    expect(copy.description).toMatch(/Press Start/);
  });

  it("deallocated stays deallocated; deleted has no card", async () => {
    const { cardStatusAfterCancel } = await import("@/lib/cancel-outcome");
    expect(cardStatusAfterCancel(parseCancelResponse("vm1", "lab1", { deleted: false, status: "deallocated" }))).toBe("deallocated");
    expect(cardStatusAfterCancel(parseCancelResponse("vm1", "lab1", { action: "cancelled", deleted: true }))).toBeNull();
  });
});
