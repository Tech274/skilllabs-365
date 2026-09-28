import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cronSecretMatches } from "./cron-auth.ts";
import { withCronSecretEnv } from "./cron-auth.test-helpers.ts";

const FIXTURE = "cron-test-fixture";

Deno.test("cron secret matches only an equal non-empty header", async () => {
  await withCronSecretEnv(FIXTURE, () => {
    assertEquals(cronSecretMatches(FIXTURE), true);
    assertEquals(cronSecretMatches("wrong-cron-fixture"), false);
    assertEquals(cronSecretMatches(FIXTURE.slice(0, FIXTURE.length - 1)), false);
    assertEquals(cronSecretMatches(FIXTURE + "-extra"), false);
    assertEquals(cronSecretMatches(null), false);
    assertEquals(cronSecretMatches(""), false);
    // The secret and the header are compared exactly. No trim.
    assertEquals(cronSecretMatches(" " + FIXTURE), false);
    assertEquals(cronSecretMatches(FIXTURE + " "), false);
    assertEquals(cronSecretMatches(FIXTURE + "\n"), false);
  });
  await withCronSecretEnv(FIXTURE + "\n", () => {
    assertEquals(cronSecretMatches(FIXTURE), false);
    assertEquals(cronSecretMatches(FIXTURE + "\n"), true);
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
