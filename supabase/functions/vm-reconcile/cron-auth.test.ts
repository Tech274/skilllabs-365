import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withCronSecretEnv, withLockedEnv } from "../_shared/cron-auth.test-helpers.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("VM_RECONCILE_SKIP_SERVE", "1");
const { handleVmReconcile } = await import("./index.ts");

const FIXTURE = "cron-test-fixture";
const ANON = "anon-test-fixture";
const ADMIN_JWT = "admin-jwt-test-fixture";
const LIVE_BODY = { scope: "fleet", dry_run: true };

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
  return { client: { from, rpc: () => Promise.resolve({ data: null, error: null }) }, writes };
}

function request(
  secret: string | null,
  body: Record<string, unknown> = LIVE_BODY,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("https://example.test/vm-reconcile", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Stub GoTrue + is_platform_admin so requireAdmin accepts ADMIN_JWT. */
async function withAdminJwt<T>(fn: () => Promise<T>): Promise<T> {
  const savedUrl = Deno.env.get("SUPABASE_URL");
  const savedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const original = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-fixture");
  globalThis.fetch = (input: Request | URL | string, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(new Response(JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "admin@example.test",
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.includes("is_platform_admin")) {
      return Promise.resolve(new Response("true", {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    return original(input, init);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    if (savedUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", savedUrl);
    if (savedKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", savedKey);
  }
}

async function call(secret: string | null, client?: { from: (table: string) => unknown }) {
  const res = await handleVmReconcile(request(secret), client ? { supabase: client } : undefined);
  const body = await res.json();
  return { status: res.status, body };
}

Deno.test("vm-reconcile empty x-cron-secret is 401", async () => {
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call("");
    assertEquals(res.status, 401);
    assertEquals(res.body.error, "Unauthorized");
  });
});

Deno.test("vm-reconcile wrong or missing cron secret is 401", async () => {
  await withCronSecretEnv(FIXTURE, async () => {
    const wrong = await call("wrong-cron-fixture");
    assertEquals(wrong.status, 401);
    const missing = await call(null);
    assertEquals(missing.status, 401);
  });
});

Deno.test("vm-reconcile unset or empty CRON_SHARED_SECRET is 401", async () => {
  await withCronSecretEnv(null, async () => {
    const res = await call(FIXTURE);
    assertEquals(res.status, 401);
  });
  await withCronSecretEnv("", async () => {
    const res = await call(FIXTURE);
    assertEquals(res.status, 401);
  });
});

Deno.test("vm-reconcile omits dry_run and defaults to dry-run", async () => {
  const { client, writes } = emptyClient();
  await withLockedEnv({
    CRON_SHARED_SECRET: FIXTURE,
    VM_RECONCILE_MODE: null,
    VM_RECONCILE_DRY_RUN: null,
  }, async () => {
    const res = await handleVmReconcile(
      request(FIXTURE, { scope: "fleet" }, { Authorization: `Bearer ${ANON}` }),
      { supabase: client },
    );
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.dry_run, true);
    assertEquals(body.checked, 0);
    assertEquals(body.changed, []);
    assertEquals(writes, []);
  });
});

Deno.test("vm-reconcile live cron shape is 200: anon bearer, matching x-cron-secret, fleet dry_run", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await handleVmReconcile(
      request(FIXTURE, LIVE_BODY, { Authorization: `Bearer ${ANON}` }),
      { supabase: client },
    );
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.dry_run, true);
    assertEquals(body.checked, 0);
    assertEquals(body.changed, []);
    assertEquals(writes, []);
  });
});

Deno.test("vm-reconcile accepts an admin JWT when x-cron-secret is missing or wrong", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, () =>
    withAdminJwt(async () => {
      const missing = await handleVmReconcile(
        request(null, LIVE_BODY, { Authorization: `Bearer ${ADMIN_JWT}` }),
        { supabase: client },
      );
      const missingBody = await missing.json();
      assertEquals(missing.status, 200);
      assertEquals(missingBody.dry_run, true);
      assertEquals(missingBody.checked, 0);

      const wrong = await handleVmReconcile(
        request("wrong-cron-fixture", LIVE_BODY, { Authorization: `Bearer ${ADMIN_JWT}` }),
        { supabase: client },
      );
      const wrongBody = await wrong.json();
      assertEquals(wrong.status, 200);
      assertEquals(wrongBody.dry_run, true);
      assertEquals(wrongBody.checked, 0);
      assertEquals(writes, []);
    })
  );
});

Deno.test("vm-reconcile right cron secret is 200 and writes nothing on an empty fleet", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call(FIXTURE, client);
    assertEquals(res.status, 200);
    assertEquals(res.body.dry_run, true);
    assertEquals(res.body.checked, 0);
    assertEquals(res.body.changed, []);
    assertEquals(writes, []);
  });
});
