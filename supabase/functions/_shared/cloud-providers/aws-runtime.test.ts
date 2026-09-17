import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapToAwsInstanceType, awsInstanceTypeVcpus } from "./aws-runtime.ts";

Deno.test("mapToAwsInstanceType maps Azure SKUs and passes through EC2 types", () => {
  assertEquals(mapToAwsInstanceType("Standard_B2s"), "t3.small");
  assertEquals(mapToAwsInstanceType("Standard_B2ms"), "t3.medium");
  assertEquals(mapToAwsInstanceType("t3.large"), "t3.large");
  assertEquals(mapToAwsInstanceType(""), "t3.medium");
});

Deno.test("awsInstanceTypeVcpus estimates common sizes", () => {
  assertEquals(awsInstanceTypeVcpus("t3.small"), 2);
  assertEquals(awsInstanceTypeVcpus("t3.xlarge"), 4);
  assertEquals(awsInstanceTypeVcpus("m5.2xlarge"), 8);
});
