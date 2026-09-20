import { describe, expect, it } from "vitest";
import { isResumableStatus, needsRemint } from "@/lib/lab-remint";

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
});
