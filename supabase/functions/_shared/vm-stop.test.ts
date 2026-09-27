import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  interpretStopConfirm,
  newStopPollBudget,
  pollCloudUntilFinal,
  POLL_INTERVAL_MS,
} from "./vm-stop.ts";

Deno.test("stop-confirm: only final states confirm", () => {
  assertEquals(interpretStopConfirm("aws", "stopped").ok, true);
  assertEquals(interpretStopConfirm("aws", "stopped").pending, undefined);
  assertEquals(interpretStopConfirm("azure", "deallocated").ok, true);
  assertEquals(interpretStopConfirm("azure", "stopped").ok, true);
});

Deno.test("stop-confirm: transitional states are pending, never success", () => {
  for (const state of ["stopping"]) {
    const aws = interpretStopConfirm("aws", state);
    assertEquals(aws.ok, false);
    assertEquals(aws.pending, true);
  }
  for (const state of ["stopping", "deallocating"]) {
    const az = interpretStopConfirm("azure", state);
    assertEquals(az.ok, false);
    assertEquals(az.pending, true);
  }
  const running = interpretStopConfirm("aws", "running");
  assertEquals(running.ok, false);
  assertEquals(running.pending, undefined);
});

Deno.test("stop-confirm: budget timeout on a transitional state stays pending", async () => {
  let ticks = 0;
  const nowBox = { t: 1_000 };
  const budget = newStopPollBudget(POLL_INTERVAL_MS);
  const state = await pollCloudUntilFinal({
    provider: "aws",
    budget,
    now: () => nowBox.t,
    sleep: async (ms) => {
      nowBox.t += ms;
    },
    describe: async () => {
      ticks += 1;
      return "stopping";
    },
  });
  assertEquals(state, "stopping");
  assertEquals(ticks >= 1, true);
  const verdict = interpretStopConfirm("aws", state);
  assertEquals(verdict.ok, false);
  assertEquals(verdict.pending, true);
  assertEquals(budget.remainingMs <= 0, true);
});

Deno.test("stop-confirm: poll returns as soon as a final state is seen", async () => {
  const seen = ["stopping", "stopped"];
  const budget = newStopPollBudget(90_000);
  let sleeps = 0;
  const state = await pollCloudUntilFinal({
    provider: "aws",
    budget,
    now: () => 0,
    sleep: async () => {
      sleeps += 1;
    },
    describe: async () => seen.shift() ?? "stopped",
  });
  assertEquals(state, "stopped");
  assertEquals(sleeps, 1);
  assertEquals(interpretStopConfirm("aws", state).ok, true);
});
