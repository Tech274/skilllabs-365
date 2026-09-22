import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mapToAwsInstanceType,
  awsInstanceTypeVcpus,
  parseAwsPublicIpFromXml,
  isAwsInvalidInstanceNotFound,
  linuxLabUserDataShell,
  windowsLabUserDataScript,
  SKILLHUB_SSHD_PASSWORD_DROPIN,
} from "./aws-runtime.ts";

/**
 * Model of OpenSSH on Ubuntu cloud images: Include sshd_config.d/*.conf at
 * the top of sshd_config, lexical order, first obtained value wins. The main
 * file is consulted only when no drop-in already set PasswordAuthentication.
 * `dropIns` lists only files that set that keyword.
 */
function effectivePasswordAuthentication(
  dropIns: { name: string; passwordAuthentication: "yes" | "no" }[],
  mainFileValue: "yes" | "no" | "unset",
): "yes" | "no" | "unset" {
  const ordered = [...dropIns].sort((a, b) => a.name.localeCompare(b.name));
  if (ordered.length > 0) return ordered[0].passwordAuthentication;
  return mainFileValue;
}

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


Deno.test("isAwsInvalidInstanceNotFound detects ghost EC2 ids", () => {
  assertEquals(
    isAwsInvalidInstanceNotFound("InvalidInstanceID.NotFound: The instance ID 'i-0dd83d48a728880c5' does not exist"),
    true,
  );
  assertEquals(isAwsInvalidInstanceNotFound("IncorrectInstanceState: not startable"), false);
});

Deno.test("cloudimg drop-in beats main sshd_config and a 99- drop-in", () => {
  const cloudimg = { name: "60-cloudimg-settings.conf", passwordAuthentication: "no" as const };
  // What the old user-data sed hoped to achieve in the main file.
  const mainSed = "yes" as const;
  assertEquals(effectivePasswordAuthentication([cloudimg], mainSed), "no");
  assertEquals(
    effectivePasswordAuthentication(
      [cloudimg, { name: "99-skillhub-password.conf", passwordAuthentication: "yes" }],
      mainSed,
    ),
    "no",
  );
  assertEquals(
    effectivePasswordAuthentication(
      [
        cloudimg,
        { name: "50-cloud-init.conf", passwordAuthentication: "no" },
        { name: "00-skillhub-password.conf", passwordAuthentication: "yes" },
      ],
      mainSed,
    ),
    "yes",
  );
});

Deno.test("Ubuntu user-data writes a pre-60 PasswordAuthentication yes drop-in and restarts ssh", () => {
  const sh = linuxLabUserDataShell("labuser", "secret");
  const dropinName = SKILLHUB_SSHD_PASSWORD_DROPIN.split("/").pop() ?? "";
  assertEquals(sh.includes(SKILLHUB_SSHD_PASSWORD_DROPIN), true);
  assertEquals(sh.includes("PasswordAuthentication yes"), true);
  assertEquals(dropinName < "60-cloudimg-settings.conf", true);
  assertEquals(dropinName < "50-cloud-init.conf", true);
  assertEquals(/systemctl restart ssh/.test(sh), true);
  // The old sed of the main file does not override the cloudimg drop-in.
  assertEquals(sh.includes("sed -i"), false);
  assertEquals(
    effectivePasswordAuthentication(
      [
        { name: "60-cloudimg-settings.conf", passwordAuthentication: "no" },
        { name: dropinName, passwordAuthentication: "yes" },
      ],
      "unset",
    ),
    "yes",
  );
});

Deno.test("Windows user-data is EC2Launch powershell for the Hub username, not Ubuntu sshd", () => {
  const password = 'Aa1$ecret!"';
  const script = windowsLabUserDataScript("labuser", password);
  assertEquals(script.includes("sshd_config"), false);
  assertEquals(script.includes("PasswordAuthentication"), false);
  assertEquals(script.includes("#ps1"), false);
  assertEquals(script.includes("<powershell>"), true);
  assertEquals(script.includes("</powershell>"), true);
  // Configured local account (labuser), not the AMI Administrator, and not raw
  // so PowerShell cannot expand $ or quotes in the Hub password.
  assertEquals(script.includes("labuser"), false);
  assertEquals(script.includes(password), false);
  // Group name "Administrators" is required; the built-in account is not the dial user.
  assertEquals(script.includes("'Administrator'"), false);
  assertEquals(script.includes("net user"), false);
  assertEquals(script.includes(btoa("labuser")), true);
  assertEquals(script.includes(btoa(password)), true);
  assertEquals(script.includes("Remote Desktop Users"), true);
  assertEquals(script.includes("Administrators"), true);
  assertEquals(script.includes("PasswordComplexity = 0"), true);
  assertEquals(script.includes("fDenyTSConnections"), true);
  assertEquals(script.includes("UserAuthentication"), true);
  assertEquals(script.includes("-Value 1"), true);
});
