import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("admin persistent Start refuses a guarded VM before the wallet override and before StartInstances", () => {
  const guard = src.indexOf("if (existingVmForGate && isVmGuarded(existingVmForGate))");
  const override = src.indexOf('action: "vm.admin_start_override"');
  const start = src.indexOf("await startCloudVm(");
  assert(guard > 0, "provision-lab must check the union guard on the existing VM");
  assert(override > guard, "guarded admin Start must return before the wallet-override audit");
  assert(start > guard, "guarded remint must return before StartInstances");
  const refusal = src.slice(guard, override);
  assert(refusal.includes('code: "VM_PROTECTED"'));
  assert(refusal.includes("status: 423"));
});
