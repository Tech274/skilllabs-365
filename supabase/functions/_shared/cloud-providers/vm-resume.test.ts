import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AWS_REMINT_WAIT_CAP_MS,
  createRemintClock,
  isAwsInstanceId,
  parseAwsEc2ErrorXml,
  resolveRemintProvider,
  startCloudVm,
  waitForAwsStoppedWithinBudget,
  waitForRunningAndIps,
  type ResumableVm,
} from "./vm-resume.ts";

Deno.test("parseAwsEc2ErrorXml extracts Code and Message", () => {
  const xml = `<?xml version="1.0"?>
<Response><Errors><Error>
  <Code>IncorrectInstanceState</Code>
  <Message>The instance 'i-0dd83d40a728880c5' is not in a state from which it can be started.</Message>
</Error></Errors></Response>`;
  assertEquals(
    parseAwsEc2ErrorXml(xml),
    "IncorrectInstanceState: The instance 'i-0dd83d40a728880c5' is not in a state from which it can be started.",
  );
});

Deno.test("parseAwsEc2ErrorXml falls back when tags missing", () => {
  assertEquals(parseAwsEc2ErrorXml("  boom  "), "boom");
});

Deno.test("resolveRemintProvider: account, then template, then cloud id; i-* vs azure fails closed", () => {
  assertEquals(isAwsInstanceId("i-0123456789abcdef0"), true);
  assertEquals(isAwsInstanceId("lab-3f2a1b9c"), false);
  assertEquals(
    resolveRemintProvider({ accountProvider: "aws", templateProvider: "azure", cloudId: "lab-x" }),
    { provider: "aws", source: "account", mismatch: false },
  );
  assertEquals(
    resolveRemintProvider({ templateProvider: "azure", cloudId: "i-0123456789abcdef0" }),
    { provider: "azure", source: "template", mismatch: true },
  );
  assertEquals(
    resolveRemintProvider({ cloudId: "i-0123456789abcdef0" }),
    { provider: "aws", source: "cloud_id", mismatch: false },
  );
});

Deno.test("AWS persistent remint total wait caps at 100s across stopped and running", async () => {
  assertEquals(AWS_REMINT_WAIT_CAP_MS, 100_000);
  let t = 0;
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (msg?: unknown, ...rest: unknown[]) => {
    warns.push([msg, ...rest].map(String).join(" "));
  };
  const clock = createRemintClock({
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  const vm: ResumableVm = {
    id: "vm-1",
    status: "starting",
    azure_vm_id: "i-0123456789abcdef0",
    private_ip: null,
    provider_account_id: null,
    expires_at: null,
  };
  let runningDescribes = 0;
  try {
    const stopped = await waitForAwsStoppedWithinBudget(async () => {
      return { state: t >= 40_000 ? "stopped" : "stopping" };
    }, clock);
    assertEquals(stopped.state, "stopped");
    assertEquals(stopped.capped, undefined);
    assertEquals(t >= 40_000 && t < AWS_REMINT_WAIT_CAP_MS, true);

    const result = await waitForRunningAndIps({} as never, "aws", vm, 120_000, {
      now: clock.now,
      sleep: clock.sleep,
      startedAt: clock.startedAt,
      describe: async () => {
        runningDescribes += 1;
        return { state: "pending", publicIp: "203.0.113.5", privateIp: "10.1.1.5" };
      },
    });
    assertEquals(result.running, false);
    assertEquals(result.state, "starting");
    assertEquals(result.publicIp, null);
    assertEquals(result.privateIp, null);
    assertEquals(result.capped, true);
    assertEquals(result.elapsedMs, AWS_REMINT_WAIT_CAP_MS);
    assertEquals(t, AWS_REMINT_WAIT_CAP_MS);
    assertEquals(runningDescribes > 0, true);
    assertEquals(warns.some((w) => w.includes("aws_remint_wait_capped") && w.includes("100000")), true);
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("cap before StartInstances is a retryable failure; cap after StartInstances stays starting", async () => {
  const vm: ResumableVm = {
    id: "vm-1",
    status: "deallocated",
    azure_vm_id: "i-0123456789abcdef0",
    private_ip: null,
    provider_account_id: "acct",
    expires_at: null,
    region: "us-east-1",
  };

  let t = 0;
  const clock = createRemintClock({
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  let starts = 0;
  const beforeStart = await startCloudVm({} as never, "aws", vm, {
    clock,
    resolveAwsRuntime: async () => ({ defaultRegion: "us-east-1" }),
    describeAwsInstance: async () => ({ state: "stopping", publicIp: null, privateIp: null }),
    ec2Action: async () => {
      starts += 1;
      return { ok: true, status: 200, text: "", xml: "" };
    },
  });
  assertEquals(beforeStart.ok, false);
  assertEquals(beforeStart.code, "REMINT_START_FAILED");
  assertEquals(beforeStart.capped, true);
  assertEquals(starts, 0);
  assertEquals(t, AWS_REMINT_WAIT_CAP_MS);

  let t2 = 0;
  const clock2 = createRemintClock({
    now: () => t2,
    sleep: async (ms) => {
      t2 += ms;
    },
  });
  let starts2 = 0;
  const afterStart = await startCloudVm({} as never, "aws", vm, {
    clock: clock2,
    resolveAwsRuntime: async () => ({ defaultRegion: "us-east-1" }),
    describeAwsInstance: async () => ({ state: "stopped", publicIp: null, privateIp: null }),
    ec2Action: async () => {
      starts2 += 1;
      return { ok: true, status: 200, text: "", xml: "" };
    },
  });
  assertEquals(afterStart.ok, true);
  assertEquals(afterStart.code, undefined);
  assertEquals(starts2, 1);

  const running = await waitForRunningAndIps({} as never, "aws", vm, clock2.capMs, {
    now: clock2.now,
    sleep: clock2.sleep,
    startedAt: clock2.startedAt,
    describe: async () => ({ state: "pending", publicIp: "203.0.113.5", privateIp: "10.1.1.5" }),
  });
  assertEquals(running.running, false);
  assertEquals(running.state, "starting");
  assertEquals(running.publicIp, null);
  assertEquals(running.privateIp, null);
  assertEquals(running.capped, true);
  assertEquals(t2, AWS_REMINT_WAIT_CAP_MS);
});

Deno.test("parseAwsEc2ErrorXml extracts InvalidInstanceID.NotFound", () => {
  const xml = `<?xml version="1.0"?>
<Response><Errors><Error>
  <Code>InvalidInstanceID.NotFound</Code>
  <Message>The instance ID 'i-0dd83d48a728880c5' does not exist</Message>
</Error></Errors></Response>`;
  assertEquals(
    parseAwsEc2ErrorXml(xml),
    "InvalidInstanceID.NotFound: The instance ID 'i-0dd83d48a728880c5' does not exist",
  );
});
