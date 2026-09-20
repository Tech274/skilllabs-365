import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAwsEc2ErrorXml } from "./vm-resume.ts";

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
