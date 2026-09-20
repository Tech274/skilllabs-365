import { describe, expect, it } from "vitest";
import { buildLabWallet, endOfDayIst, formatMinutes, usedMinutesForTemplate } from "@/lib/lab-wallet";

const NOW = Date.parse("2026-09-19T12:00:00Z");

describe("lab wallet", () => {
  it("counts only session usage for the template", () => {
    const used = usedMinutesForTemplate(
      [
        { lab_template_id: "a", started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T10:30:00Z" },
        { lab_template_id: "b", started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T11:00:00Z" },
        { lab_template_id: "a", started_at: "2026-09-19T11:45:00Z", ended_at: null },
      ],
      "a",
      NOW,
    );
    expect(used).toBe(45);
  });

  it("computes allocated minus used equals remaining", () => {
    const w = buildLabWallet(
      { id: "a", duration: 120, is_persistent: false },
      [{ lab_template_id: "a", started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T10:30:00Z" }],
      NOW,
    );
    expect(w.allocatedMinutes).toBe(120);
    expect(w.usedMinutes).toBe(30);
    expect(w.remainingMinutes).toBe(90);
    expect(w.exhausted).toBe(false);
  });

  it("never goes negative and flags exhaustion", () => {
    const w = buildLabWallet(
      { id: "a", duration: 20 },
      [{ lab_template_id: "a", started_at: "2026-09-19T10:00:00Z", ended_at: "2026-09-19T11:00:00Z" }],
      NOW,
    );
    expect(w.remainingMinutes).toBe(0);
    expect(w.exhausted).toBe(true);
  });

  it("shows persistent window and detects end-of-day IST expiry", () => {
    const w = buildLabWallet(
      { id: "a", duration: 600, is_persistent: true, start_date: "2026-09-01T00:00:00Z", end_date: "2026-09-18T00:00:00Z" },
      [],
      NOW,
    );
    expect(w.startLabel).toBeTruthy();
    expect(w.endLabel).toBeTruthy();
    expect(w.windowEnded).toBe(true);
    expect(endOfDayIst("2026-09-18T00:00:00Z")).toBeLessThan(NOW);
  });

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(95)).toBe("1h 35m");
  });
});
