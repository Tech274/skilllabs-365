// AWS runtime configuration resolved from the Resource Providers registry.
// Mirrors azure-runtime.ts: credentials, default region, VPC/subnet, lab EC2 ops,
// and Service Quotas helpers used by cloud-quotas + provision-lab.
import { resolveAccount, type ProviderAccount } from "./accounts.ts";
import { ProviderConfigError } from "./azure-runtime.ts";

export interface AwsRuntime {
  accountId: string;
  displayName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  /** AWS account id when known (from STS / config). */
  awsAccountId: string | null;
  defaultRegion: string;
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  /** Optional EC2 key pair name for SSH. */
  keyName: string;
  adminUsername: string;
  adminPassword: string;
  /** Optional pinned AMI; otherwise resolved via SSM Ubuntu 22.04. */
  amiId: string;
  /** Optional default IAM role ARN for console federation (access templates). */
  defaultRoleArn: string;
  externalId: string;
}

const ADMIN_HINT = "Open Admin → Resource Providers and complete this AWS account.";
const DEFAULT_REGION = "ap-south-1";
const DEFAULT_VPC_CIDR = "10.40.0.0/16";
const DEFAULT_SUBNET_CIDR = "10.40.1.0/24";

const enc = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data) as BufferSource));
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmac(enc.encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, "aws4_request");
}

export type AwsCreds = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
};

/** Generic SigV4-signed request. */
export async function awsSignedFetch(opts: {
  creds: AwsCreds;
  region: string;
  service: string;
  method: string;
  host: string;
  path?: string;
  query?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Response> {
  const path = opts.path || "/";
  const query = opts.query || "";
  const body = opts.body ?? "";
  const bodyHash = await sha256Hex(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: opts.host,
    "x-amz-date": amzDate,
    ...(opts.headers || {}),
  };
  if (opts.creds.sessionToken) headers["x-amz-security-token"] = opts.creds.sessionToken;
  if (body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/x-www-form-urlencoded; charset=utf-8";
  }

  const sortedKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const headerMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) headerMap[k.toLowerCase()] = v.trim();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headerMap[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonical = [
    opts.method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonical)].join("\n");
  const kSigning = await signingKey(opts.creds.secretAccessKey, dateStamp, opts.region, opts.service);
  const sig = [...await hmac(kSigning, stringToSign)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const url = `https://${opts.host}${path}${query ? `?${query}` : ""}`;
  return await fetch(url, {
    method: opts.method,
    headers: { ...headers, authorization },
    body: opts.method === "GET" || opts.method === "HEAD" ? undefined : body,
  });
}

function runtimeCreds(runtime: AwsRuntime): AwsCreds {
  return {
    accessKeyId: runtime.accessKeyId,
    secretAccessKey: runtime.secretAccessKey,
    sessionToken: runtime.sessionToken,
  };
}

/** EC2 Query API helper — returns parsed XML-ish JSON via AWS's JSON? EC2 returns XML; we parse lightly. */
export async function ec2Action(
  runtime: AwsRuntime,
  action: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; text: string; xml: string }> {
  const region = runtime.defaultRegion;
  const bodyParams = new URLSearchParams({ Action: action, Version: "2016-11-15", ...params });
  const body = bodyParams.toString();
  const resp = await awsSignedFetch({
    creds: runtimeCreds(runtime),
    region,
    service: "ec2",
    method: "POST",
    host: `ec2.${region}.amazonaws.com`,
    path: "/",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body,
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text, xml: text };
}

function xmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Validate a registry account row and turn it into a usable AWS runtime. */
export function awsRuntimeFromAccount(account: ProviderAccount): AwsRuntime {
  const creds = (account.credentials ?? {}) as Record<string, string>;
  const cfg = (account.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const runtime: AwsRuntime = {
    accountId: account.id,
    displayName: account.display_name,
    accessKeyId: str(creds.access_key_id),
    secretAccessKey: str(creds.secret_access_key),
    sessionToken: str(creds.session_token) || null,
    awsAccountId: str(cfg.aws_account_id) || null,
    defaultRegion: str(account.default_region) || DEFAULT_REGION,
    vpcId: str(cfg.vpc_id),
    subnetId: str(cfg.subnet_id),
    securityGroupId: str(cfg.security_group_id),
    keyName: str(cfg.key_name),
    adminUsername: str(cfg.vm_admin_username) || "ubuntu",
    adminPassword: str(creds.vm_admin_password),
    amiId: str(cfg.ami_id),
    defaultRoleArn: str(cfg.default_role_arn),
    externalId: str(cfg.external_id),
  };

  const missing: string[] = [];
  if (!runtime.accessKeyId) missing.push("AWS Access Key ID");
  if (!runtime.secretAccessKey) missing.push("AWS Secret Access Key");
  if (missing.length) {
    throw new ProviderConfigError(
      `Resource provider "${account.display_name}" is incomplete: ${missing.join(", ")} missing.`,
      `Resource Providers → ${account.display_name}`,
      ADMIN_HINT,
    );
  }
  return runtime;
}

/** Extra requirements that only EC2 lab provisioning needs. */
export function awsVmProvisioningGaps(runtime: AwsRuntime): { field: string; label: string }[] {
  const gaps: { field: string; label: string }[] = [];
  if (!runtime.subnetId) gaps.push({ field: "subnet_id", label: "Subnet ID" });
  if (!runtime.securityGroupId) gaps.push({ field: "security_group_id", label: "Security Group ID" });
  if (!runtime.adminPassword) gaps.push({ field: "vm_admin_password", label: "VM admin password (user-data bootstrap)" });
  return gaps;
}

export function assertAwsVmProvisioningReady(runtime: AwsRuntime): void {
  const missing = awsVmProvisioningGaps(runtime).map((g) => g.label);
  if (missing.length) {
    throw new ProviderConfigError(
      `Resource provider "${runtime.displayName}" cannot provision lab VMs: ${missing.join(", ")} missing.`,
      `Resource Providers → ${runtime.displayName}`,
      ADMIN_HINT,
    );
  }
}

export async function resolveAwsRuntime(
  // deno-lint-ignore no-explicit-any
  admin: any,
  accountId?: string | null,
): Promise<AwsRuntime> {
  const account = await resolveAccount(admin, "aws", accountId ?? null);
  if (!account) {
    throw new ProviderConfigError(
      "No active AWS resource provider is registered.",
      "Resource Providers",
      "Add an AWS account under Admin → Resource Providers and mark it active (or set it as default).",
    );
  }
  return awsRuntimeFromAccount(account);
}

export async function tryResolveAwsRuntime(
  // deno-lint-ignore no-explicit-any
  admin: any,
  accountId?: string | null,
): Promise<AwsRuntime | null> {
  try {
    return await resolveAwsRuntime(admin, accountId);
  } catch {
    return null;
  }
}

/** Map Azure-style or free-text template sizes onto common EC2 instance types. */
export function mapToAwsInstanceType(vmSize: string | null | undefined): string {
  const raw = (vmSize || "").trim();
  if (/^[a-z][0-9a-z]*\.[0-9a-z]+$/i.test(raw)) return raw.toLowerCase();
  const map: Record<string, string> = {
    Standard_B1s: "t3.micro",
    Standard_B1ms: "t3.micro",
    Standard_B2s: "t3.small",
    Standard_B2ms: "t3.medium",
    Standard_B4ms: "t3.large",
    Standard_D2s_v3: "t3.medium",
    Standard_D2s_v5: "t3.medium",
    Standard_D2as_v5: "t3.medium",
    Standard_D4s_v3: "t3.large",
    Standard_D4s_v5: "t3.large",
  };
  return map[raw] || "t3.medium";
}

/** Rough vCPU count for labsFit math when template uses AWS instance types. */
export function awsInstanceTypeVcpus(instanceType: string): number {
  const t = instanceType.toLowerCase();
  if (t.endsWith(".nano") || t.endsWith(".micro")) return 2;
  if (t.endsWith(".small")) return 2;
  if (t.endsWith(".medium")) return 2;
  if (t.endsWith(".large")) return 2;
  if (t.endsWith(".xlarge")) return 4;
  if (t.endsWith(".2xlarge")) return 8;
  return 2;
}

async function ssmGetParameter(runtime: AwsRuntime, name: string): Promise<string> {
  const region = runtime.defaultRegion;
  const body = JSON.stringify({ Name: name, WithDecryption: false });
  const resp = await awsSignedFetch({
    creds: runtimeCreds(runtime),
    region,
    service: "ssm",
    method: "POST",
    host: `ssm.${region}.amazonaws.com`,
    path: "/",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AmazonSSM.GetParameter",
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`SSM GetParameter failed (${resp.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const value = json?.Parameter?.Value;
  if (!value) throw new Error("SSM GetParameter returned no Value");
  return String(value);
}

/** Resolve Ubuntu 22.04 AMI for the runtime region (or use pinned ami_id). */
export async function resolveLabAmiId(runtime: AwsRuntime, osImage?: string | null): Promise<string> {
  if (runtime.amiId) return runtime.amiId;
  const image = (osImage || "").toLowerCase();
  const param = image.includes("windows")
    ? "/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base"
    : "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id";
  return await ssmGetParameter(runtime, param);
}

/** List VPCs + subnets for the admin subnet picker. */
export async function listAwsNetworks(runtime: AwsRuntime): Promise<{
  vpcs: {
    id: string;
    name: string;
    cidr: string | null;
    subnets: { id: string; name: string; az: string | null; cidr: string | null }[];
  }[];
}> {
  const vpcRes = await ec2Action(runtime, "DescribeVpcs");
  if (!vpcRes.ok) throw new Error(`Failed to list VPCs (${vpcRes.status}): ${vpcRes.text.slice(0, 300)}`);
  const subnetRes = await ec2Action(runtime, "DescribeSubnets");
  if (!subnetRes.ok) throw new Error(`Failed to list subnets (${subnetRes.status}): ${subnetRes.text.slice(0, 300)}`);

  // Parse VPC blocks
  const vpcBlocks = vpcRes.xml.split(/<item>/).slice(1);
  const vpcs: {
    id: string;
    name: string;
    cidr: string | null;
    subnets: { id: string; name: string; az: string | null; cidr: string | null }[];
  }[] = [];

  for (const block of vpcBlocks) {
    const id = xmlTag(block, "vpcId");
    if (!id) continue;
    const cidr = xmlTag(block, "cidrBlock");
    const nameMatch = block.match(/<key>Name<\/key>\s*<value>([^<]*)<\/value>/);
    vpcs.push({
      id,
      name: nameMatch?.[1] || id,
      cidr,
      subnets: [],
    });
  }

  const subnetBlocks = subnetRes.xml.split(/<item>/).slice(1);
  for (const block of subnetBlocks) {
    const id = xmlTag(block, "subnetId");
    const vpcId = xmlTag(block, "vpcId");
    if (!id || !vpcId) continue;
    const vpc = vpcs.find((v) => v.id === vpcId);
    if (!vpc) continue;
    const nameMatch = block.match(/<key>Name<\/key>\s*<value>([^<]*)<\/value>/);
    vpc.subnets.push({
      id,
      name: nameMatch?.[1] || id,
      az: xmlTag(block, "availabilityZone"),
      cidr: xmlTag(block, "cidrBlock"),
    });
  }

  return { vpcs };
}

/**
 * Ensure a usable subnet + security group for lab EC2.
 * Reuses configured ids, otherwise discovers/creates skilllabs VPC/subnet/SG and persists.
 */
export async function ensureAwsNetwork(
  // deno-lint-ignore no-explicit-any
  admin: any,
  runtime: AwsRuntime,
): Promise<{
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  created: boolean;
  source: "configured" | "discovered" | "created";
}> {
  if (runtime.subnetId && runtime.securityGroupId && runtime.vpcId) {
    return {
      vpcId: runtime.vpcId,
      subnetId: runtime.subnetId,
      securityGroupId: runtime.securityGroupId,
      created: false,
      source: "configured",
    };
  }

  let created = false;
  let source: "configured" | "discovered" | "created" = "discovered";
  let vpcId = runtime.vpcId;
  let subnetId = runtime.subnetId;
  let securityGroupId = runtime.securityGroupId;

  // If subnet is known but VPC is not, resolve VPC from the subnet.
  if (subnetId && !vpcId) {
    const sub = await ec2Action(runtime, "DescribeSubnets", { "SubnetId.1": subnetId });
    if (sub.ok) vpcId = xmlTag(sub.xml, "vpcId") || vpcId;
  }

  if (!vpcId || !subnetId) {
    const networks = await listAwsNetworks(runtime);
    const withSubnets = networks.vpcs.filter((v) => v.subnets.length > 0);
    const preferred = withSubnets[0];
    if (preferred) {
      vpcId = preferred.id;
      subnetId = preferred.subnets[0].id;
    }
  }

  if (!vpcId || !subnetId) {
    created = true;
    source = "created";
    const createVpc = await ec2Action(runtime, "CreateVpc", {
      CidrBlock: DEFAULT_VPC_CIDR,
      "TagSpecification.1.ResourceType": "vpc",
      "TagSpecification.1.Tag.1.Key": "Name",
      "TagSpecification.1.Tag.1.Value": "skilllabs-vpc",
      "TagSpecification.1.Tag.2.Key": "managedBy",
      "TagSpecification.1.Tag.2.Value": "skilllabs",
    });
    if (!createVpc.ok) {
      throw new ProviderConfigError(
        `Resource provider "${runtime.displayName}" has no Subnet ID and automatic VPC setup failed: ${createVpc.text.slice(0, 300)}`,
        `Resource Providers → ${runtime.displayName}`,
        ADMIN_HINT,
      );
    }
    vpcId = xmlTag(createVpc.xml, "vpcId") || "";
    if (!vpcId) throw new ProviderConfigError("CreateVpc succeeded but returned no vpcId", `Resource Providers → ${runtime.displayName}`, ADMIN_HINT);

    await ec2Action(runtime, "ModifyVpcAttribute", { VpcId: vpcId, "EnableDnsSupport.Value": "true" });
    await ec2Action(runtime, "ModifyVpcAttribute", { VpcId: vpcId, "EnableDnsHostnames.Value": "true" });

    const createSubnet = await ec2Action(runtime, "CreateSubnet", {
      VpcId: vpcId,
      CidrBlock: DEFAULT_SUBNET_CIDR,
      "TagSpecification.1.ResourceType": "subnet",
      "TagSpecification.1.Tag.1.Key": "Name",
      "TagSpecification.1.Tag.1.Value": "skilllabs-subnet",
      "TagSpecification.1.Tag.2.Key": "managedBy",
      "TagSpecification.1.Tag.2.Value": "skilllabs",
    });
    if (!createSubnet.ok) {
      throw new ProviderConfigError(
        `Automatic subnet creation failed: ${createSubnet.text.slice(0, 300)}`,
        `Resource Providers → ${runtime.displayName}`,
        ADMIN_HINT,
      );
    }
    subnetId = xmlTag(createSubnet.xml, "subnetId") || "";
  }

  if (!securityGroupId) {
    // Prefer an existing skilllabs SG in the VPC
    const sgList = await ec2Action(runtime, "DescribeSecurityGroups", {
      "Filter.1.Name": "vpc-id",
      "Filter.1.Value.1": vpcId,
      "Filter.2.Name": "group-name",
      "Filter.2.Value.1": "skilllabs-lab-sg",
    });
    const existingSg = sgList.ok ? xmlTag(sgList.xml, "groupId") : null;
    if (existingSg) {
      securityGroupId = existingSg;
    } else {
      created = true;
      source = "created";
      const createSg = await ec2Action(runtime, "CreateSecurityGroup", {
        GroupName: "skilllabs-lab-sg",
        Description: "SkillLabs lab VM access (SSH/RDP)",
        VpcId: vpcId,
        "TagSpecification.1.ResourceType": "security-group",
        "TagSpecification.1.Tag.1.Key": "managedBy",
        "TagSpecification.1.Tag.1.Value": "skilllabs",
      });
      if (!createSg.ok) {
        throw new ProviderConfigError(
          `Automatic security group creation failed: ${createSg.text.slice(0, 300)}`,
          `Resource Providers → ${runtime.displayName}`,
          ADMIN_HINT,
        );
      }
      securityGroupId = xmlTag(createSg.xml, "groupId") || "";
      // Ingress SSH + RDP from VPC CIDR (private lab network)
      await ec2Action(runtime, "AuthorizeSecurityGroupIngress", {
        GroupId: securityGroupId,
        "IpPermissions.1.IpProtocol": "tcp",
        "IpPermissions.1.FromPort": "22",
        "IpPermissions.1.ToPort": "22",
        "IpPermissions.1.IpRanges.1.CidrIp": DEFAULT_VPC_CIDR,
        "IpPermissions.2.IpProtocol": "tcp",
        "IpPermissions.2.FromPort": "3389",
        "IpPermissions.2.ToPort": "3389",
        "IpPermissions.2.IpRanges.1.CidrIp": DEFAULT_VPC_CIDR,
      });
    }
  }

  if (!subnetId || !securityGroupId) {
    throw new ProviderConfigError(
      `Resource provider "${runtime.displayName}" is missing network settings after auto-setup.`,
      `Resource Providers → ${runtime.displayName}`,
      ADMIN_HINT,
    );
  }

  try {
    const { data: row } = await admin
      .from("cloud_provider_accounts").select("config").eq("id", runtime.accountId).maybeSingle();
    await admin
      .from("cloud_provider_accounts")
      .update({
        config: {
          ...(row?.config ?? {}),
          vpc_id: vpcId,
          subnet_id: subnetId,
          security_group_id: securityGroupId,
        },
      })
      .eq("id", runtime.accountId);
  } catch { /* non-fatal */ }

  runtime.vpcId = vpcId;
  runtime.subnetId = subnetId;
  runtime.securityGroupId = securityGroupId;
  return { vpcId, subnetId, securityGroupId, created, source };
}

function userDataScript(username: string, password: string, isWindows: boolean): string {
  if (isWindows) {
    const ps = `#ps1
net user ${username} "${password}" /add
net localgroup administrators ${username} /add
`;
    return btoa(ps);
  }
  const sh = `#!/bin/bash
set -e
useradd -m -s /bin/bash ${username} || true
echo '${username}:${password}' | chpasswd
usermod -aG sudo ${username} || true
sed -i 's/^PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config || true
systemctl restart ssh || systemctl restart sshd || true
`;
  return btoa(sh);
}

/**
 * Parse public IPv4 from EC2 DescribeInstances / RunInstances XML.
 * Prefers instance-level ipAddress, then publicIpAddress, then association publicIp.
 */
export function parseAwsPublicIpFromXml(xml: string): string | null {
  return (
    xmlTag(xml, "ipAddress") ||
    xmlTag(xml, "publicIpAddress") ||
    xmlTag(xml, "publicIp") ||
    null
  );
}

/** Launch an EC2 lab instance. Returns instance id + IPs (public may be pending). */
export async function createAwsVm(
  runtime: AwsRuntime,
  opts: {
    name: string;
    instanceType: string;
    amiId: string;
    osImage?: string | null;
  },
): Promise<{ instanceId: string; privateIp: string; publicIp: string | null }> {
  assertAwsVmProvisioningReady(runtime);
  const isWindows = (opts.osImage || "").toLowerCase().includes("windows");
  const params: Record<string, string> = {
    ImageId: opts.amiId,
    InstanceType: opts.instanceType,
    MinCount: "1",
    MaxCount: "1",
    "NetworkInterface.1.DeviceIndex": "0",
    "NetworkInterface.1.SubnetId": runtime.subnetId,
    "NetworkInterface.1.Groups.1": runtime.securityGroupId,
    // Required for cross-region Guac (ap-south-1) → us-east-1 labs: guacd cannot
    // route to RFC1918. Lab SG already allows gateway_cidr 3.6.228.159/32.
    "NetworkInterface.1.AssociatePublicIpAddress": "true",
    "TagSpecification.1.ResourceType": "instance",
    "TagSpecification.1.Tag.1.Key": "Name",
    "TagSpecification.1.Tag.1.Value": opts.name,
    "TagSpecification.1.Tag.2.Key": "managedBy",
    "TagSpecification.1.Tag.2.Value": "skilllabs",
    "TagSpecification.1.Tag.3.Key": "purpose",
    "TagSpecification.1.Tag.3.Value": "lab-vm",
    UserData: userDataScript(runtime.adminUsername, runtime.adminPassword, isWindows),
  };
  if (runtime.keyName) params.KeyName = runtime.keyName;

  const res = await ec2Action(runtime, "RunInstances", params);
  if (!res.ok) throw new Error(`EC2 RunInstances failed (${res.status}): ${res.text.slice(0, 500)}`);
  const instanceId = xmlTag(res.xml, "instanceId");
  if (!instanceId) throw new Error("RunInstances response missing instanceId");
  const privateIp = xmlTag(res.xml, "privateIpAddress") || "pending";
  const publicIp = parseAwsPublicIpFromXml(res.xml);
  return { instanceId, privateIp, publicIp };
}

export type AwsInstanceState = "pending" | "running" | "stopping" | "stopped" | "shutting-down" | "terminated" | "unknown";

export type AwsDescribeResult = {
  state: AwsInstanceState;
  privateIp: string | null;
  publicIp: string | null;
};

export async function describeAwsInstance(
  runtime: AwsRuntime,
  instanceId: string,
): Promise<AwsDescribeResult> {
  const res = await ec2Action(runtime, "DescribeInstances", {
    "InstanceId.1": instanceId,
  });
  if (!res.ok) throw new Error(`DescribeInstances failed (${res.status}): ${res.text.slice(0, 300)}`);
  const stateMatch = res.xml.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/);
  const state = (stateMatch?.[1] as AwsInstanceState | undefined) || "unknown";
  const privateIp = xmlTag(res.xml, "privateIpAddress");
  const publicIp = parseAwsPublicIpFromXml(res.xml);
  return { state, privateIp, publicIp };
}

export async function stopAwsInstance(runtime: AwsRuntime, instanceId: string): Promise<void> {
  const res = await ec2Action(runtime, "StopInstances", { "InstanceId.1": instanceId });
  if (!res.ok) throw new Error(`StopInstances failed (${res.status}): ${res.text.slice(0, 300)}`);
}

export async function terminateAwsInstance(runtime: AwsRuntime, instanceId: string): Promise<void> {
  const res = await ec2Action(runtime, "TerminateInstances", { "InstanceId.1": instanceId });
  if (!res.ok) throw new Error(`TerminateInstances failed (${res.status}): ${res.text.slice(0, 300)}`);
}

/** Service Quotas GetServiceQuota (JSON 1.1). */
export async function getServiceQuota(
  runtime: AwsRuntime,
  region: string,
  serviceCode: string,
  quotaCode: string,
): Promise<{ value: number; name: string; unit: string } | null> {
  const body = JSON.stringify({ ServiceCode: serviceCode, QuotaCode: quotaCode });
  const resp = await awsSignedFetch({
    creds: runtimeCreds(runtime),
    region,
    service: "servicequotas",
    method: "POST",
    host: `servicequotas.${region}.amazonaws.com`,
    path: "/",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "ServiceQuotasV20190624.GetServiceQuota",
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    // Fall back to default quota when applied quota is missing
    const defBody = JSON.stringify({ ServiceCode: serviceCode, QuotaCode: quotaCode });
    const defResp = await awsSignedFetch({
      creds: runtimeCreds(runtime),
      region,
      service: "servicequotas",
      method: "POST",
      host: `servicequotas.${region}.amazonaws.com`,
      path: "/",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "ServiceQuotasV20190624.GetAWSDefaultServiceQuota",
      },
      body: defBody,
    });
    const defText = await defResp.text();
    if (!defResp.ok) return null;
    const defJson = JSON.parse(defText);
    const q = defJson?.Quota;
    if (!q) return null;
    return { value: Number(q.Value) || 0, name: String(q.QuotaName || quotaCode), unit: String(q.Unit || "None") };
  }
  const json = JSON.parse(text);
  const q = json?.Quota;
  if (!q) return null;
  return { value: Number(q.Value) || 0, name: String(q.QuotaName || quotaCode), unit: String(q.Unit || "None") };
}

/** Count running/pending On-Demand instance vCPUs in a region (usage estimate). */
export async function countRunningVcpus(runtime: AwsRuntime, region: string): Promise<number> {
  const temp: AwsRuntime = { ...runtime, defaultRegion: region };
  const res = await ec2Action(temp, "DescribeInstances", {
    "Filter.1.Name": "instance-state-name",
    "Filter.1.Value.1": "pending",
    "Filter.1.Value.2": "running",
  });
  if (!res.ok) return 0;
  const types = xmlTags(res.xml, "instanceType");
  let total = 0;
  for (const t of types) total += awsInstanceTypeVcpus(t);
  return total;
}

/** Count Elastic IPs allocated in a region. */
export async function countElasticIps(runtime: AwsRuntime, region: string): Promise<number> {
  const temp: AwsRuntime = { ...runtime, defaultRegion: region };
  const res = await ec2Action(temp, "DescribeAddresses");
  if (!res.ok) return 0;
  return xmlTags(res.xml, "allocationId").length;
}

/** Preflight: STS GetCallerIdentity via shared aws.ts helper. */
export async function verifyAwsCredentials(runtime: AwsRuntime): Promise<{
  ok: boolean;
  message: string;
  account?: string;
  arn?: string;
}> {
  try {
    const { stsGetCallerIdentity } = await import("./aws.ts");
    const id = await stsGetCallerIdentity({
      accessKeyId: runtime.accessKeyId,
      secretAccessKey: runtime.secretAccessKey,
      sessionToken: runtime.sessionToken,
    });
    return {
      ok: true,
      message: `Connected as ${id.Arn ?? id.Account}`,
      account: id.Account,
      arn: id.Arn,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "STS failed" };
  }
}
