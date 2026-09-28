import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withCronSecretEnv } from "../_shared/cron-auth.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("CLEANUP_SKIP_SERVE", "1");
const { handleCleanupRequest } = await import("./index.ts");

const FIXTURE = "cron-test-fixture";
const HELD_ID = "bba27e8f-1111-4111-8111-111111111111";

function chainClient(rowsFor: (table: string) => unknown[]) {
  const writes: string[] = [];
  const from = (table: string) => {
    const rows = rowsFor(table);
    const result = { data: rows, error: null, count: 0 };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of [
      "select", "eq", "is", "in", "or", "order", "limit", "filter",
      "gte", "neq", "not", "lt", "lte", "gt", "range",
    ]) {
      builder[method] = chain;
    }
    builder.maybeSingle = () => Promise.resolve({
      data: table === "lab_templates" ? (rows[0] ?? null) : null,
      error: null,
    });
    builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
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
  return {
    client: { from, rpc: () => Promise.resolve({ data: false, error: null }) },
    writes,
  };
}

function emptyClient() {
  return chainClient(() => []);
}

function heldPreviewClient() {
  return chainClient((table) => {
    if (table === "virtual_machines") {
      return [{
        id: HELD_ID,
        azure_vm_id: "i-0123456789abcdef0",
        status: "running",
        expires_at: "2000-01-01T00:00:00.000Z",
        user_id: "owner",
        lab_template_id: "tpl-1",
        provider_account_id: null,
        region: null,
      }];
    }
    if (table === "lab_templates") {
      return [{ id: "tpl-1", name: "Lab", duration: 60, is_persistent: false, end_date: null }];
    }
    return [];
  });
}

function request(action: string | null, secret: string | null, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  const body = action === null ? extra : { action, ...extra };
  return new Request("https://example.test/cleanup-idle-labs", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function call(
  action: string | null,
  secret: string | null,
  client: { from: (table: string) => unknown; rpc: () => Promise<unknown> },
  extra: Record<string, unknown> = {},
) {
  const cloud: string[] = [];
  const res = await handleCleanupRequest(request(action, secret, extra), {
    supabase: client,
    onCloud: (name) => cloud.push(name),
  });
  const body = await res.json();
  return { status: res.status, body, cloud };
}

Deno.test("wrong cron secret is 401 and does not run cleanup", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call("scheduled-cleanup", "wrong-cron-fixture", client);
    assertEquals(res.status, 401);
    assertEquals(writes, []);
    assertEquals(res.cloud, []);
  });
});

Deno.test("missing cron secret is 401", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call("scheduled-cleanup", null, client);
    assertEquals(res.status, 401);
    assertEquals(writes, []);
    assertEquals(res.cloud, []);
  });
});

Deno.test("unset or empty CRON_SHARED_SECRET is 401", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(null, async () => {
    const res = await call("scheduled-cleanup", FIXTURE, client);
    assertEquals(res.status, 401);
    assertEquals(writes, []);
  });
  await withCronSecretEnv("", async () => {
    const res = await call("expiry-preview", FIXTURE, client);
    assertEquals(res.status, 401);
    assertEquals(writes, []);
    assertEquals(res.cloud, []);
  });
});

Deno.test("right cron secret is 200 for scheduled-cleanup and writes nothing on an empty fleet", async () => {
  const { client, writes } = emptyClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const named = await call("scheduled-cleanup", FIXTURE, client);
    assertEquals(named.status, 200);
    assertEquals(named.body.success, true);
    assertEquals(writes, []);
    assertEquals(named.cloud, []);

    const omitted = await call(null, FIXTURE, client);
    assertEquals(omitted.status, 200);
    assertEquals(omitted.body.success, true);
    assertEquals(omitted.cloud, []);
  });
});

Deno.test("right cron secret is 200 for expiry-preview, read-only, and skips the built-in hold", async () => {
  const { client, writes } = heldPreviewClient();
  await withCronSecretEnv(FIXTURE, async () => {
    const res = await call("expiry-preview", FIXTURE, client);
    assertEquals(res.status, 200);
    assertEquals(res.body.success, true);
    assertEquals(res.body.action, "expiry-preview");
    assertEquals(res.body.dry_run, true);
    assertEquals(writes, []);
    assertEquals(res.cloud, []);
    const due = res.body.due as Array<{ vm_id: string; held: boolean; would_deallocate: boolean }>;
    assertEquals(due.length, 1);
    assertEquals(due[0].vm_id, HELD_ID);
    assertEquals(due[0].held, true);
    assertEquals(due[0].would_deallocate, false);
    const heldIds = res.body.held_vm_ids as string[];
    assertEquals(heldIds.includes("bba27e8f"), true);
  });
});

Deno.test("right cron secret cannot call admin-only mutating actions", async () => {
  const { client, writes } = emptyClient();
  const actions = [
    "stop-vm",
    "delete-vm",
    "cancel-provisioning",
    "start-vm",
    "learner-leave",
    "purge-failed",
    "clear-guacamole",
  ];
  await withCronSecretEnv(FIXTURE, async () => {
    for (const action of actions) {
      const res = await call(action, FIXTURE, client, { vm_id: HELD_ID });
      assertEquals(res.status, 403, action);
      assertEquals(writes, []);
      assertEquals(res.cloud, []);
    }
  });
});
