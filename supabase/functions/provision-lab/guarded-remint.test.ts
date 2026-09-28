import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const classifier = await Deno.readTextFile(new URL("../_shared/admin-start-override.ts", import.meta.url));

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

Deno.test("capped remint is 503 retryable with no row clear, and the override audit follows the result", () => {
  const startedWrite = src.indexOf("if (started) {");
  const clear = src.indexOf("ended_at: null");
  const startCall = src.indexOf("await startCloudVm(");
  const helper = src.indexOf("const writeAdminStartOverrideAudit");
  const failedAudit = src.indexOf('writeAdminStartOverrideAudit("failed"');
  const resultAudit = src.indexOf("writeAdminStartOverrideAudit(\n        adminRestartOutcome(");
  const retryable = src.indexOf("retryable: true");
  assert(startedWrite > 0 && clear > startedWrite, "ended_* is cleared only after a start was accepted");
  assert(helper > 0 && !src.slice(0, helper).includes('action: "vm.admin_start_override"'), "override audit is not written up front");
  assert(failedAudit > startCall, "failed override audit is after StartInstances returns");
  assert(resultAudit > failedAudit, "override audit records the real restart outcome");
  assert(!src.includes('writeAdminStartOverrideAudit("success")'), "override audit must not record a blanket success");
  assert(src.includes("adminRestartOutcome(") && src.includes("error_code"));
  assert(src.includes("adminStartOverrideMessage("), "override audit message comes from the outcome classifier");
  assert(classifier.includes('"already_running"') && classifier.includes('"already_starting"') && classifier.includes('"start_accepted"'));
  assert(retryable > failedAudit && retryable < resultAudit, "retryable 503 is the cap-before-start failure");
});
