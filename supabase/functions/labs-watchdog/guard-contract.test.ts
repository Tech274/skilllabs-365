import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("watchdog auto-terminate checks the union guard before delete", () => {
  const branch = src.indexOf("protected — auto-terminate skipped");
  const terminate = src.indexOf("await terminateAwsInstance");
  assert(branch > 0 && terminate > branch, "auto-terminate must refuse a guarded VM before terminate");
  assert(src.includes('res.code === "VM_PROTECTED"'));
  const beforeSessions = src.indexOf("A protected VM must not lose its session");
  const sessionClose = src.indexOf('.update({ status: "completed", ended_at: nowIso })', beforeSessions);
  assert(beforeSessions > 0 && sessionClose > beforeSessions);
});
