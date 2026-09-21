import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapToAwsInstanceType, awsInstanceTypeVcpus, parseAwsPublicIpFromXml } from "./aws-runtime.ts";

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

Deno.test("parseAwsPublicIpFromXml prefers ipAddress then publicIpAddress", () => {
  const withIpAddress = `<item><privateIpAddress>10.0.6.33</privateIpAddress><ipAddress>3.228.218.133</ipAddress></item>`;
  assertEquals(parseAwsPublicIpFromXml(withIpAddress), "3.228.218.133");

  const withPublicIpAddress = `<item><privateIpAddress>10.0.2.99</privateIpAddress><publicIpAddress>98.92.163.169</publicIpAddress></item>`;
  assertEquals(parseAwsPublicIpFromXml(withPublicIpAddress), "98.92.163.169");

  const associationOnly = `<association><publicIp>54.1.2.3</publicIp><ipOwnerId>amazon</ipOwnerId></association>`;
  assertEquals(parseAwsPublicIpFromXml(associationOnly), "54.1.2.3");

  const privateOnly = `<item><privateIpAddress>10.0.6.33</privateIpAddress></item>`;
  assertEquals(parseAwsPublicIpFromXml(privateOnly), null);
});
