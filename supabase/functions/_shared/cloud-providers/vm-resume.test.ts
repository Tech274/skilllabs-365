import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AWS_REMINT_WAIT_CAP_MS,
  isAwsInstanceId,
  parseAwsEc2ErrorXml,
  resolveRemintProvider,
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

Deno.test("AWS persistent remint wait caps at 110s and returns starting with no IPs", async () => {
  let t = 0;
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (msg?: unknown, ...rest: unknown[]) => {
    warns.push([msg, ...rest].map(String).join(" "));
  };
  const vm: ResumableVm = {
    id: "vm-1",
    status: "starting",
    azure_vm_id: "i-0123456789abcdef0",
    private_ip: null,
    provider_account_id: null,
    expires_at: null,
  };
  try {
    const result = await waitForRunningAndIps({} as never, "aws", vm, 120_000, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      describe: async () => ({ state: "pending", publicIp: "203.0.113.5", privateIp: "10.1.1.5" }),
    });
    assertEquals(result.running, false);
    assertEquals(result.state, "starting");
    assertEquals(result.publicIp, null);
    assertEquals(result.privateIp, null);
    assertEquals(result.capped, true);
    assertEquals(result.elapsedMs, AWS_REMINT_WAIT_CAP_MS);
    assertEquals(t, AWS_REMINT_WAIT_CAP_MS);
    assertEquals(AWS_REMINT_WAIT_CAP_MS, 110_000);
    assertEquals(warns.some((w) => w.includes("aws_remint_wait_capped") && w.includes("110000")), true);
  } finally {
    console.warn = origWarn;
  }
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
