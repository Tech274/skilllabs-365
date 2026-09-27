import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAwsInstanceId, parseAwsEc2ErrorXml, resolveRemintProvider } from "./vm-resume.ts";

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
