import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AuthCtx } from "../_shared/auth.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("CHECK_VM_STATUS_SKIP_SERVE", "1");
const { handleCheckVmStatus } = await import("./index.ts");

Deno.test("check-vm-status returns a guarded VM as stored, with no describe and no write", async () => {
  const vm = {
    id: "bba27e8f-2222-4222-8222-222222222222",
    azure_vm_id: "i-0123456789abcdef0",
    status: "provisioning",
    user_id: "owner",
    provider_account_id: "acct",
    region: "us-east-1",
  };
  const writes: string[] = [];
  const cloud: string[] = [];
  const from = (table: string) => {
    const terminal = () => ({ data: table === "virtual_machines" ? vm : null, error: null });
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.maybeSingle = () => Promise.resolve(terminal());
    builder.update = () => {
      writes.push(`${table}.update`);
      return builder;
    };
    builder.insert = () => {
      writes.push(`${table}.insert`);
      return Promise.resolve({ error: null });
    };
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal()).then(resolve);
    return builder;
  };
  const supabase = { from, rpc: () => Promise.resolve({ data: false, error: null }) };
  const auth: AuthCtx = {
    supabase: supabase as never,
    userId: "owner",
    email: null,
    isServiceRole: true,
  };
  const res = await handleCheckVmStatus(
    new Request("https://example.test/check-vm-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vm_id: vm.id }),
    }),
    { auth, supabase, onCloud: (name) => cloud.push(name) },
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.status, "provisioning");
  assertEquals(body.code, "VM_PROTECTED");
  assertEquals(writes, []);
  assertEquals(cloud, []);
});
