import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withCronSecretEnv } from "../_shared/cron-auth.test-helpers.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("LABS_WATCHDOG_SKIP_SERVE", "1");
const { handleLabsWatchdog } = await import("./index.ts");

const FIXTURE = "cron-test-fixture";

function emptyClient() {
  const writes: string[] = [];
  const from = (table: string) => {
    const result = { data: [], error: null, count: 0 };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of [
      "select", "eq", "is", "in", "or", "order", "limit", "filter",
      "gte", "neq", "not", "lt", "lte", "gt", "range",
    ]) {
      builder[method] = chain;
    }
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    builder.single = () => Promise.resolve({ data: null, error: null });
    for (const op of ["update", "insert", "delete", "upsert"]) {
      builder[op] = () => {
        writes.push(`${table}.${op}`);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return builder;
  };
  return { client: { from, rpc: () => Promise.resolve({ data: false, error: null }) }, writes };
}

function request(secret: string | null, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("https://example.test/labs-watchdog", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function call(secret: string | null, client?: { from: (table: string) => unknown }) {
  const res = await handleLabsWatchdog(request(secret), client ? { supabase: client } : undefined);
  const body = await res.json();
  return { status: res.status, body };
}

Deno.test("labs-watchdog empty x-cron-secret is 401", async () => {
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call("");
    assertEquals(res.status, 401);
    assertEquals(res.body.error, "Unauthorized");
  });
});

Deno.test("labs-watchdog wrong or missing cron secret is 401", async () => {
  await withCronSecretEnv(FIXTURE, async () => {
    const wrong = await call("wrong-cron-fixture");
    assertEquals(wrong.status, 401);
    const missing = await call(null);
    assertEquals(missing.status, 401);
  });
});

Deno.test("labs-watchdog unset or empty CRON_SHARED_SECRET is 401", async () => {
  await withCronSecretEnv(null, async () => {
    const res = await call(FIXTURE);
    assertEquals(res.status, 401);
  });
  await withCronSecretEnv("", async () => {
    const res = await call(FIXTURE);
    assertEquals(res.status, 401);
  });
});

Deno.test("labs-watchdog right cron secret is 200 and writes nothing on an empty fleet", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call(FIXTURE, client);
    assertEquals(res.status, 200);
    assertEquals(res.body.success, true);
    assertEquals(res.body.cleaned, 0);
    assertEquals(writes, []);
  });
});
