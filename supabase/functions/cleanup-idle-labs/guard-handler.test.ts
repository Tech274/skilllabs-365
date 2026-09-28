import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AuthCtx } from "../_shared/auth.ts";
import { withLockedEnv } from "../_shared/cron-auth.test-helpers.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("CLEANUP_SKIP_SERVE", "1");
const { handleCleanupRequest } = await import("./index.ts");

const GUARDED_ID = "bba27e8f-1111-4111-8111-111111111111";

function mockSupabase(vm: Record<string, unknown>) {
  const writes: string[] = [];
  const from = (table: string) => {
    const terminal = () => {
      if (table === "virtual_machines") return { data: vm, error: null, count: 0 };
      return { data: null, error: null, count: 0 };
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.is = chain;
    builder.in = chain;
    builder.or = chain;
    builder.order = chain;
    builder.limit = chain;
    builder.filter = chain;
    builder.gte = chain;
    builder.neq = chain;
    builder.not = chain;
    builder.maybeSingle = () => Promise.resolve(terminal());
    builder.single = () => Promise.resolve(terminal());
    for (const op of ["update", "insert", "delete", "upsert"]) {
      builder[op] = () => {
        writes.push(`${table}.${op}`);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal()).then(resolve, reject);
    return builder;
  };
  const client = {
    from,
    rpc: () => Promise.resolve({ data: false, error: null }),
  };
  const auth: AuthCtx = {
    supabase: client as never,
    userId: "00000000-0000-0000-0000-000000000001",
    email: null,
    isServiceRole: true,
  };
  return { client, writes, auth };
}

async function invoke(
  action: string,
  vm: Record<string, unknown>,
  extra?: { startCloudVm?: (supabase: unknown, provider: string, row: unknown) => Promise<Record<string, unknown>> },
) {
  return await withLockedEnv({}, async () => {
  const cloud: string[] = [];
  const { client, writes, auth } = mockSupabase(vm);
  const res = await handleCleanupRequest(
    new Request("https://example.test/cleanup-idle-labs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, vm_id: vm.id }),
    }),
    { supabase: client, auth, onCloud: (name) => cloud.push(name), startCloudVm: extra?.startCloudVm as never },
  );
  const body = await res.json();
  return { status: res.status, body, writes, cloud };
  });
}

Deno.test("guarded stop, delete and cancel write nothing and call no cloud", async () => {
  const vm = {
    id: GUARDED_ID,
    azure_vm_id: "i-0123456789abcdef0",
    status: "running",
    user_id: "owner",
    lab_template_id: "tpl",
    provider_account_id: "acct",
    region: "us-east-1",
    private_ip: "10.0.0.5",
    expires_at: null,
    ended_reason: null,
  };

  const stop = await invoke("stop-vm", vm);
  assertEquals(stop.status, 423);
  assertEquals(stop.body.code, "VM_PROTECTED");
  assertEquals(stop.writes, []);
  assertEquals(stop.cloud, []);

  const del = await invoke("delete-vm", vm);
  assertEquals(del.status, 423);
  assertEquals(del.body.code, "VM_PROTECTED");
  assertEquals(del.writes, []);
  assertEquals(del.cloud, []);

  const cancel = await invoke("cancel-provisioning", vm);
  assertEquals(cancel.status, 423);
  assertEquals(cancel.body.code, "VM_PROTECTED");
  assertEquals(cancel.writes, []);
  assertEquals(cancel.cloud, []);
});

Deno.test("guarded leave closes only the learner session and calls no cloud", async () => {
  const vm = {
    id: GUARDED_ID,
    azure_vm_id: "i-0123456789abcdef0",
    status: "running",
    user_id: "owner",
    lab_template_id: "tpl",
    provider_account_id: "acct",
    region: "us-east-1",
    private_ip: "10.0.0.5",
    expires_at: null,
    ended_reason: null,
  };
  const leave = await invoke("learner-leave", vm);
  assertEquals(leave.status, 200);
  assertEquals(leave.body.success, true);
  assertEquals(leave.body.kept_running, true);
  assertEquals(leave.body.reason, "VM_PROTECTED");
  assertEquals(typeof leave.body.message, "string");
  assertEquals(String(leave.body.message).toLowerCase().includes("protected"), true);
  assertEquals(String(leave.body.message).toLowerCase().includes("left running"), true);
  assertEquals(leave.writes, ["sessions.update"]);
  assertEquals(leave.cloud, []);
});

Deno.test("guarded leave closes only the caller's session when two are active on the VM", async () => {
  const caller = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000099";
  const sessions = [
    { id: "sess-caller", vm_id: GUARDED_ID, user_id: caller, status: "active", ended_at: null as string | null, disconnect_reason: null as string | null },
    { id: "sess-other", vm_id: GUARDED_ID, user_id: other, status: "active", ended_at: null as string | null, disconnect_reason: null as string | null },
    { id: "sess-caller-2", vm_id: GUARDED_ID, user_id: caller, status: "active", ended_at: null as string | null, disconnect_reason: null as string | null },
  ];
  const vmWrites: string[] = [];
  const vm = {
    id: GUARDED_ID,
    azure_vm_id: "i-0123456789abcdef0",
    status: "running",
    user_id: "owner",
    lab_template_id: "tpl",
    provider_account_id: "acct",
    region: "us-east-1",
    private_ip: "10.0.0.5",
    expires_at: null,
    ended_reason: null,
  };
  const from = (table: string) => {
    const eqs: { col: string; val: unknown }[] = [];
    let patch: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.is = chain;
    builder.in = chain;
    builder.or = chain;
    builder.order = chain;
    builder.limit = chain;
    builder.filter = chain;
    builder.gte = chain;
    builder.neq = chain;
    builder.not = chain;
    builder.eq = (col: string, val: unknown) => {
      eqs.push({ col, val });
      return builder;
    };
    builder.update = (next: Record<string, unknown>) => {
      patch = next;
      if (table === "virtual_machines") vmWrites.push("virtual_machines.update");
      return builder;
    };
    builder.insert = () => {
      if (table === "virtual_machines") vmWrites.push("virtual_machines.insert");
      return builder;
    };
    builder.delete = () => {
      if (table === "virtual_machines") vmWrites.push("virtual_machines.delete");
      return builder;
    };
    const apply = () => {
      if (table === "sessions" && patch) {
        for (const row of sessions) {
          const match = eqs.every((f) => (row as Record<string, unknown>)[f.col] === f.val);
          if (match) Object.assign(row, patch);
        }
      }
      if (table === "virtual_machines") return { data: vm, error: null, count: 0 };
      return { data: null, error: null, count: 0 };
    };
    builder.maybeSingle = () => Promise.resolve(apply());
    builder.single = () => Promise.resolve(apply());
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(apply()).then(resolve, reject);
    return builder;
  };
  const client = {
    from,
    rpc: () => Promise.resolve({ data: false, error: null }),
  };
  const auth: AuthCtx = {
    supabase: client as never,
    userId: caller,
    email: null,
    isServiceRole: true,
  };
  const cloud: string[] = [];
  const leave = async (sessionId?: string) => {
    for (const row of sessions) {
      row.status = "active";
      row.ended_at = null;
      row.disconnect_reason = null;
    }
    const res = await handleCleanupRequest(
      new Request("https://example.test/cleanup-idle-labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "learner-leave",
          vm_id: vm.id,
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      }),
      { supabase: client, auth, onCloud: (name) => cloud.push(name) },
    );
    return { status: res.status, body: await res.json() };
  };

  const unscoped = await leave();
  assertEquals(unscoped.status, 200);
  assertEquals(unscoped.body.kept_running, true);
  assertEquals(unscoped.body.reason, "VM_PROTECTED");
  assertEquals(sessions.find((row) => row.id === "sess-caller")?.status, "completed");
  assertEquals(sessions.find((row) => row.id === "sess-caller-2")?.status, "completed");
  assertEquals(sessions.find((row) => row.id === "sess-other")?.status, "active");

  const scoped = await leave("sess-caller");
  assertEquals(scoped.status, 200);
  assertEquals(sessions.find((row) => row.id === "sess-caller")?.status, "completed");
  assertEquals(sessions.find((row) => row.id === "sess-caller-2")?.status, "active");
  assertEquals(sessions.find((row) => row.id === "sess-other")?.status, "active");
  assertEquals(vmWrites, []);
  assertEquals(cloud, []);
});

Deno.test("start-vm capped before StartInstances is 503 retryable and writes nothing", async () => {
  const vm = {
    id: "11111111-2222-4333-8444-555555555555",
    azure_vm_id: "i-0abc",
    status: "stopped",
    user_id: "owner",
    lab_template_id: "tpl",
    provider_account_id: "acct",
    region: "us-east-1",
    private_ip: "10.0.0.8",
    expires_at: "2026-09-28T00:00:00.000Z",
    ended_reason: null,
    ended_at: "2026-09-27T00:00:00.000Z",
  };
  const started = await invoke("start-vm", vm, {
    startCloudVm: async () => ({
      ok: false,
      code: "REMINT_START_FAILED",
      capped: true,
      awsState: "stopping",
      detail: "remint wait cap hit before StartInstances",
    }),
  });
  assertEquals(started.status, 503);
  assertEquals(started.body.code, "REMINT_START_FAILED");
  assertEquals(started.body.retryable, true);
  assertEquals(started.writes, []);
  assertEquals(started.cloud.includes("describeAwsInstance"), false);
});
