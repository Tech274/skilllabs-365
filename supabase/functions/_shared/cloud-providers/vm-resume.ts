/**
 * Persistent lab REMINT / resume.
 *
 * Learner Leave soft-stops (deallocates) the VM but keeps the allocation.
 * A Start inside the grant + template window (and with wallet minutes remaining)
 * must power the SAME VM back on — never create or destroy on Start.
 *
 * Soft-expiry (end_date EOD IST, or minutes exhausted) also deallocates + notifies.
 * Exhausted wallet blocks Start; the VM is held, never silently terminated.
 */

import {
  describeAwsInstance,
  ec2Action,
  isAwsInvalidInstanceNotFound,
  resolveAwsRuntime,
  type AwsInstanceState,
} from "./aws-runtime.ts";
import { resolveAzureRuntime } from "./azure-runtime.ts";

type SupabaseLike = {
  from: (table: string) => any;
};

/** Statuses that mean "allocation exists, compute is simply off". */
export const RESUMABLE_VM_STATUSES = ["deallocated", "stopped"] as const;
/** Statuses that mean "allocation exists and is live" — hand it straight back. */
export const LIVE_VM_STATUSES = ["provisioning", "starting", "running", "idle"] as const;

export type ResumableVm = {
  id: string;
  status: string;
  azure_vm_id: string | null;
  private_ip: string | null;
  provider_account_id: string | null;
  expires_at: string | null;
  /** Prefer this region for AWS StartInstances (same allocation). */
  region?: string | null;
};

export type StartCloudVmResult = {
  ok: boolean;
  /** Short reason for logs / 502 `detail` (AWS Code/Message or Azure status). */
  detail?: string;
  awsState?: AwsInstanceState;
  /**
   * Hub row points at an EC2 id AWS no longer knows (InvalidInstanceID.NotFound).
   * Callers must mark the Hub VM failed/terminated — never StartInstances.
   */
  ghost?: boolean;
  /** i-* id would have been sent to Azure start — refused (REMINT_PROVIDER_MISMATCH). */
  mismatch?: boolean;
};

/** Newest reusable VM this learner already holds for this template, if any. */
export async function findResumableVm(
  supabase: SupabaseLike,
  args: { userId: string; labTemplateId: string },
): Promise<ResumableVm | null> {
  const { data } = await supabase
    .from("virtual_machines")
    .select("id, status, azure_vm_id, private_ip, provider_account_id, expires_at, region")
    .eq("user_id", args.userId)
    .eq("lab_template_id", args.labTemplateId)
    .in("status", [...LIVE_VM_STATUSES, ...RESUMABLE_VM_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ResumableVm | null) ?? null;
}

function extractAzureVmName(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

async function azureToken(rt: { tenantId: string; clientId: string; clientSecret: string }): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${rt.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: rt.clientId,
      client_secret: rt.clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure token request failed (${res.status})`);
  return (await res.json()).access_token as string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull AWS Query API error Code + Message from XML for 502 detail. */
export function parseAwsEc2ErrorXml(xml: string): string {
  const code = xml.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = xml.match(/<Message>([^<]+)<\/Message>/)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (code) return code;
  if (message) return message;
  const trimmed = xml.replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 240) || "unknown AWS error";
}

async function waitUntilAwsStopped(
  rt: Awaited<ReturnType<typeof resolveAwsRuntime>>,
  instanceId: string,
  maxMs = 90_000,
): Promise<{ state: AwsInstanceState; detail?: string }> {
  const deadline = Date.now() + maxMs;
  let last: AwsInstanceState = "stopping";
  while (Date.now() < deadline) {
    const desc = await describeAwsInstance(rt, instanceId);
    last = desc.state;
    if (desc.state === "stopped") return { state: "stopped" };
    if (desc.state === "terminated" || desc.state === "shutting-down") {
      return { state: desc.state, detail: `instance ${instanceId} is ${desc.state} — cannot Start` };
    }
    if (desc.state === "running" || desc.state === "pending") {
      // Leave failed mid-stop / race — treat as already up.
      return { state: desc.state };
    }
    await sleep(3_000);
  }
  return { state: last, detail: `timed out waiting for stopped (last=${last})` };
}

/** True when the cloud id is an EC2 instance id (i-xxxxxxxx). */
export function isAwsInstanceId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^i-[0-9a-f]{8,}$/i.test(id.trim());
}

/**
 * 15i.1 remint provider resolve order:
 *   (a) cloud_provider_accounts.provider for vm.provider_account_id
 *   (b) lab_templates.provider
 *   (c) azure_vm_id "i-*" → aws; anything else → azure
 * A lone vm.provider stamp is NEVER consulted (DB default is 'azure').
 * If the resolved answer is azure but the id is i-*, callers get mismatch and fail closed.
 */
export function resolveRemintProvider(args: {
  accountProvider?: string | null;
  templateProvider?: string | null;
  cloudId?: string | null;
}): { provider: "aws" | "azure"; source: "account" | "template" | "cloud_id"; mismatch: boolean } {
  const norm = (p?: string | null) => (p === "aws" || p === "azure" ? p : null);
  const idSays: "aws" | "azure" = isAwsInstanceId(args.cloudId) ? "aws" : "azure";
  const acct = norm(args.accountProvider);
  const tmpl = norm(args.templateProvider);
  const provider = acct ?? tmpl ?? idSays;
  const source = acct ? "account" : tmpl ? "template" : "cloud_id";
  const mismatch = provider === "azure" && isAwsInstanceId(args.cloudId);
  return { provider, source, mismatch };
}

/**
 * After a successful Start, poll the cloud until Running and return the FRESH
 * IPs. Never reuse a deallocated-era public_ip.
 */
export async function waitForRunningAndIps(
  supabase: SupabaseLike,
  provider: string,
  vm: ResumableVm,
  maxMs = 120_000,
): Promise<{ running: boolean; state: string; publicIp: string | null; privateIp: string | null }> {
  if (provider !== "aws" || !vm.azure_vm_id) {
    return { running: false, state: "starting", publicIp: null, privateIp: null };
  }
  const rt = await resolveAwsRuntime(supabase, vm.provider_account_id);
  if (vm.region) rt.defaultRegion = String(vm.region);
  const deadline = Date.now() + maxMs;
  let last = { state: "pending" as string, publicIp: null as string | null, privateIp: null as string | null };
  while (Date.now() < deadline) {
    const d = await describeAwsInstance(rt, String(vm.azure_vm_id));
    last = { state: d.state, publicIp: d.publicIp, privateIp: d.privateIp };
    if (d.state === "running" && d.publicIp) return { running: true, ...last };
    if (d.state === "terminated" || d.state === "shutting-down" || d.state === "not-found") break;
    await sleep(4_000);
  }
  return { running: false, ...last };
}

/**
 * Power the existing allocation back on. Returns ok when the cloud accepted the
 * start (or the instance is already running/pending). The VM row is never
 * deleted or recreated here.
 *
 * AWS path is describe-first so Start-from-deallocated still works when Leave
 * marked Hub deallocated but StopInstances failed (cloud_stop_ok:false) and the
 * EC2 is still running — and when the instance is mid-stopping.
 */
export async function startCloudVm(
  supabase: SupabaseLike,
  provider: string,
  vm: ResumableVm,
): Promise<StartCloudVmResult> {
  if (!vm.azure_vm_id) return { ok: false, detail: "VM has no cloud instance id" };

  // Fail closed: never send an EC2 i-* id to the Azure start API.
  if (provider !== "aws" && isAwsInstanceId(vm.azure_vm_id)) {
    return {
      ok: false,
      mismatch: true,
      detail: `REMINT_PROVIDER_MISMATCH: ${vm.azure_vm_id} is an EC2 id but resolved provider is ${provider}`,
    };
  }

  if (provider === "aws") {
    const instanceId = String(vm.azure_vm_id);
    try {
      const rt = await resolveAwsRuntime(supabase, vm.provider_account_id);
      if (vm.region) rt.defaultRegion = String(vm.region);

      const desc0 = await describeAwsInstance(rt, instanceId);
      let state: AwsInstanceState = desc0.state;

      // Ghost Hub row: DescribeInstances InvalidInstanceID.NotFound — never Start.
      if (state === "not-found") {
        const detail =
          `InvalidInstanceID.NotFound: instance ${instanceId} does not exist — Hub row is a ghost`;
        console.error(`StartInstances blocked (ghost): ${detail}`);
        return { ok: false, awsState: "not-found", detail, ghost: true };
      }

      // Idempotent: Hub may say deallocated while EC2 is still running after a
      // failed soft-stop — Start must succeed without calling StartInstances.
      if (state === "running" || state === "pending") {
        console.log(JSON.stringify({
          event: "aws_start_idempotent",
          instance_id: instanceId,
          region: rt.defaultRegion,
          state,
        }));
        return { ok: true, awsState: state, detail: `already ${state}` };
      }

      if (state === "terminated" || state === "shutting-down") {
        const detail = `instance ${instanceId} is ${state} — cannot Start`;
        console.error(`StartInstances blocked: ${detail}`);
        return { ok: false, awsState: state, detail };
      }

      if (state === "stopping") {
        const waited = await waitUntilAwsStopped(rt, instanceId);
        if (waited.state === "running" || waited.state === "pending") {
          return { ok: true, awsState: waited.state, detail: `already ${waited.state} after wait` };
        }
        if (waited.state !== "stopped") {
          console.error(`StartInstances wait failed: ${waited.detail}`);
          return { ok: false, awsState: waited.state, detail: waited.detail };
        }
        state = "stopped";
      }

      if (state !== "stopped" && state !== "unknown") {
        const detail = `instance ${instanceId} in unexpected state ${state}`;
        return { ok: false, awsState: state, detail };
      }

      const res = await ec2Action(rt, "StartInstances", { "InstanceId.1": instanceId });
      if (!res.ok) {
        const detail = parseAwsEc2ErrorXml(res.text);
        console.error(`StartInstances failed (${res.status}): ${detail}`);
        if (isAwsInvalidInstanceNotFound(detail) || isAwsInvalidInstanceNotFound(res.text)) {
          return { ok: false, awsState: "not-found", detail, ghost: true };
        }
        return { ok: false, awsState: state, detail };
      }
      return { ok: true, awsState: "pending", detail: "StartInstances accepted" };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`AWS startCloudVm error: ${detail}`);
      if (isAwsInvalidInstanceNotFound(detail)) {
        return { ok: false, awsState: "not-found", detail, ghost: true };
      }
      return { ok: false, detail };
    }
  }

  try {
    const rt = await resolveAzureRuntime(supabase, vm.provider_account_id);
    const token = await azureToken(rt);
    const name = extractAzureVmName(vm.azure_vm_id);
    const res = await fetch(
      `https://management.azure.com/subscriptions/${rt.subscriptionId}/resourceGroups/${rt.resourceGroup}` +
        `/providers/Microsoft.Compute/virtualMachines/${name}/start?api-version=2023-03-01`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.error(`Azure start failed for ${name} (${res.status}): ${body}`);
      return { ok: false, detail: `Azure start ${res.status}: ${body}` };
    }
    return { ok: true, detail: "Azure start accepted" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`Azure startCloudVm error: ${detail}`);
    return { ok: false, detail };
  }
}
