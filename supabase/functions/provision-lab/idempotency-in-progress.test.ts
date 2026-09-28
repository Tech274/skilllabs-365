import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("in-flight idempotency 409 body uses code IDEMPOTENCY_IN_PROGRESS", () => {
  const start = src.indexOf('if (claim.outcome === "in_progress")');
  assert(start > 0, "provision-lab must handle an in-progress idempotency claim");
  const block = src.slice(start, start + 900);
  assert(block.includes("status: 409"), "in-progress claim must stay a 409");
  assert(
    block.includes('code: "IDEMPOTENCY_IN_PROGRESS"'),
    "in-progress 409 body must include code IDEMPOTENCY_IN_PROGRESS",
  );
  assert(
    block.includes("A provisioning request with this idempotency key is already in progress."),
    "in-progress 409 must keep the learner-facing error",
  );
  // Other 409s must not be relabelled as the idempotency conflict.
  const notResumable = src.indexOf('code: "NOT_RESUMABLE"');
  assert(notResumable > 0, "NOT_RESUMABLE 409 must remain");
  const notResumableBlock = src.slice(Math.max(0, notResumable - 400), notResumable + 200);
  assert(!notResumableBlock.includes("IDEMPOTENCY_IN_PROGRESS"));
});
