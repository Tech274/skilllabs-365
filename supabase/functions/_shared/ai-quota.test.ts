import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { evaluateQuota } from "./ai-quota.ts";

Deno.test("allows usage below both limits", () => {
  const d = evaluateQuota({ scope: "user", per_minute_limit: 10, daily_limit: 100 }, 3, 20);
  assertEquals(d.allowed, true);
});

Deno.test("blocks when the per-minute limit is reached", () => {
  const d = evaluateQuota({ scope: "user", per_minute_limit: 5, daily_limit: 100 }, 5, 20);
  assertEquals(d.allowed, false);
  assertEquals(d.window, "minute");
  assertEquals(d.retryAfterSeconds, 60);
});

Deno.test("blocks when the daily cap is reached", () => {
  const d = evaluateQuota({ scope: "org", per_minute_limit: 50, daily_limit: 100 }, 1, 100);
  assertEquals(d.allowed, false);
  assertEquals(d.window, "day");
  assertEquals(d.scope, "org");
});

Deno.test("treats zero as unlimited", () => {
  const d = evaluateQuota({ scope: "global", per_minute_limit: 0, daily_limit: 0 }, 9999, 99999);
  assertEquals(d.allowed, true);
});
