import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cronSecretMatches, withCronSecretEnv } from "./cron-auth.ts";

const FIXTURE = "cron-test-fixture";

Deno.test("cron secret matches only an equal non-empty header", async () => {
  await withCronSecretEnv(FIXTURE, () => {
    assertEquals(cronSecretMatches(FIXTURE), true);
    assertEquals(cronSecretMatches("wrong-cron-fixture"), false);
    assertEquals(cronSecretMatches(FIXTURE.slice(0, FIXTURE.length - 1)), false);
    assertEquals(cronSecretMatches(FIXTURE + "-extra"), false);
    assertEquals(cronSecretMatches(null), false);
    assertEquals(cronSecretMatches(""), false);
  });
});

Deno.test("cron secret rejects an unset or empty env var", async () => {
  await withCronSecretEnv(null, () => {
    assertEquals(cronSecretMatches(FIXTURE), false);
    assertEquals(cronSecretMatches(""), false);
  });
  await withCronSecretEnv("", () => {
    assertEquals(cronSecretMatches(""), false);
    assertEquals(cronSecretMatches(FIXTURE), false);
  });
});
