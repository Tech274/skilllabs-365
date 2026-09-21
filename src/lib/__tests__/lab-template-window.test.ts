import { describe, expect, it } from "vitest";
import {
  endDateFromDuration,
  istDateToEndIso,
  istDateToStartIso,
  toIstDateInput,
  validateGrantWindow,
  validatePrepaidMinutes,
  validateTemplateWindow,
} from "@/lib/lab-template-window";

describe("IST window conversion", () => {
  it("maps a calendar date to IST start/end instants", () => {
    expect(istDateToStartIso("2026-10-01")).toBe("2026-09-30T18:30:00.000Z");
    expect(istDateToEndIso("2026-10-01")).toBe("2026-10-01T18:29:59.999Z");
  });

  it("round-trips an instant back to the IST calendar date", () => {
    expect(toIstDateInput("2026-10-01T18:29:59.999Z")).toBe("2026-10-01");
  });

  it("derives an inclusive end date from duration days", () => {
    expect(endDateFromDuration("2026-10-01", 30)).toBe("2026-10-30");
  });
});


describe("validatePrepaidMinutes", () => {
  it("requires duration > 0 for prepaid pool (persistent included)", () => {
    expect(validatePrepaidMinutes(0)).toMatch(/greater than 0/i);
    expect(validatePrepaidMinutes(-5)).toMatch(/greater than 0/i);
    expect(validatePrepaidMinutes(Number.NaN)).toMatch(/greater than 0/i);
    expect(validatePrepaidMinutes(200)).toBeNull();
  });
});

describe("validateTemplateWindow", () => {
  it("ignores non-persistent templates", () => {
    expect(validateTemplateWindow({ isPersistent: false, startDate: "", endDate: "" })).toBeNull();
  });

  it("requires both dates for persistent templates", () => {
    expect(validateTemplateWindow({ isPersistent: true, startDate: "", endDate: "2026-10-01" })).toMatch(/start date/i);
    expect(validateTemplateWindow({ isPersistent: true, startDate: "2026-10-01", endDate: "" })).toMatch(/end date/i);
  });

  it("requires end after start", () => {
    expect(
      validateTemplateWindow({ isPersistent: true, startDate: "2026-10-05", endDate: "2026-10-01" }),
    ).toMatch(/after the start date/i);
    expect(
      validateTemplateWindow({ isPersistent: true, startDate: "2026-10-01", endDate: "2026-10-30" }),
    ).toBeNull();
  });
});

describe("validateGrantWindow", () => {
  const cap = istDateToEndIso("2026-10-30")!;

  it("allows anything when no template window exists", () => {
    expect(validateGrantWindow(null, null)).toBeNull();
  });

  it("rejects an open-ended grant against a capped template", () => {
    expect(validateGrantWindow(null, cap)).toMatch(/no end date/i);
  });

  it("rejects a grant past the template end", () => {
    expect(validateGrantWindow("2026-11-05T00:00:00.000Z", cap)).toMatch(/after the lab template end/i);
  });

  it("accepts a grant inside the template window", () => {
    expect(validateGrantWindow("2026-10-20T00:00:00.000Z", cap)).toBeNull();
  });
});
