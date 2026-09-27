import { describe, expect, it } from "vitest";
import {
  buildUsageReport,
  formatMinutes,
  istDay,
  sessionMinutes,
  usageLearnersCsv,
  usageWindowStart,
} from "@/lib/usage-report";

// 27 Sep 2026 20:00 IST
const NOW = Date.parse("2026-09-27T14:30:00Z");

describe("usage-report", () => {
  it("window starts at 00:00 IST, days-1 back", () => {
    expect(usageWindowStart(1, NOW).toISOString()).toBe("2026-09-26T18:30:00.000Z");
    expect(usageWindowStart(7, NOW).toISOString()).toBe("2026-09-20T18:30:00.000Z");
  });

  it("istDay buckets by IST, not UTC", () => {
    // 26 Sep 19:00 UTC = 27 Sep 00:30 IST
    expect(istDay("2026-09-26T19:00:00Z")).toBe("2026-09-27");
  });

  it("session minutes: closed, open-through-now, invalid", () => {
    expect(sessionMinutes({ id: "a", user_id: null, lab_template_id: null, started_at: "2026-09-27T13:00:00Z", ended_at: "2026-09-27T13:45:00Z" }, NOW)).toBe(45);
    expect(sessionMinutes({ id: "b", user_id: null, lab_template_id: null, started_at: "2026-09-27T14:00:00Z", ended_at: null }, NOW)).toBe(30);
    expect(sessionMinutes({ id: "c", user_id: null, lab_template_id: null, started_at: null, ended_at: null }, NOW)).toBe(0);
    expect(sessionMinutes({ id: "d", user_id: null, lab_template_id: null, started_at: "2026-09-27T14:00:00Z", ended_at: "2026-09-27T13:00:00Z" }, NOW)).toBe(0);
  });

  it("aggregates totals, per-day, per-lab and per-learner", () => {
    const r = buildUsageReport({
      days: 7,
      nowMs: NOW,
      sessions: [
        { id: "1", user_id: "u1", lab_template_id: "t1", started_at: "2026-09-27T10:00:00Z", ended_at: "2026-09-27T11:00:00Z" },
        { id: "2", user_id: "u1", lab_template_id: "t1", started_at: "2026-09-26T10:00:00Z", ended_at: "2026-09-26T10:30:00Z" },
        { id: "3", user_id: "u2", lab_template_id: "t2", started_at: "2026-09-27T14:00:00Z", ended_at: null },
        // outside the 7-day window
        { id: "4", user_id: "u3", lab_template_id: "t2", started_at: "2026-09-10T10:00:00Z", ended_at: "2026-09-10T12:00:00Z" },
      ],
      vms: [{ status: "running" }, { status: "idle" }, { status: "deallocated" }, { status: "Running" }],
      templates: [{ id: "t1", name: "AWS Win" }, { id: "t2", name: "Ubuntu" }],
      profiles: [{ user_id: "u1", display_name: "Asha", email: "asha@example.com" }],
    });
    expect(r.totals).toEqual({ sessions: 3, minutes: 120, learners: 2, avgSessionMinutes: 40, openSessions: 1 });
    expect(r.byDay).toHaveLength(7);
    expect(r.byDay.at(-1)).toEqual({ date: "2026-09-27", sessions: 2, minutes: 90 });
    expect(r.byDay.at(-2)).toEqual({ date: "2026-09-26", sessions: 1, minutes: 30 });
    expect(r.byLab[0]).toMatchObject({ templateId: "t1", name: "AWS Win", sessions: 2, minutes: 90, learners: 1 });
    expect(r.byLearner[0]).toMatchObject({ userId: "u1", name: "Asha", minutes: 90, sessions: 2 });
    expect(r.byLearner[1].name).toBe("u2…");
    expect(r.vmsByStatus).toEqual({ running: 2, idle: 1, deallocated: 1 });
    expect(r.liveVms).toBe(3);
  });

  it("CSV escapes quotes and neutralises formula cells", () => {
    const r = buildUsageReport({
      days: 1,
      nowMs: NOW,
      sessions: [{ id: "1", user_id: "u1", lab_template_id: null, started_at: "2026-09-27T10:00:00Z", ended_at: "2026-09-27T10:10:00Z" }],
      vms: [],
      templates: [],
      profiles: [{ user_id: "u1", display_name: '=HYPERLINK("x")', email: "a@b.c" }],
    });
    const csv = usageLearnersCsv(r).split("\n");
    expect(csv[0]).toBe("learner,email,sessions,minutes,last_started_ist");
    expect(csv[1]).toBe(`"'=HYPERLINK(""x"")",a@b.c,1,10,2026-09-27`);
  });

  it("formatMinutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(-5)).toBe("0m");
  });

  it("exact vmStatusCounts win over a sampled vms list", () => {
    const r = buildUsageReport({
      days: 1, nowMs: NOW, sessions: [], templates: [], profiles: [],
      vms: [{ status: "running" }],
      vmStatusCounts: { running: 1200, idle: 3, terminated: 9000, failed: 0 },
    });
    expect(r.liveVms).toBe(1203);
    expect(r.vmsByStatus).toEqual({ running: 1200, idle: 3, terminated: 9000 });
  });
});
