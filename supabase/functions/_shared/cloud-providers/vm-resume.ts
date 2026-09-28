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
  awsState?: AwsInstanceState | "starting";
  /**
   * Hub row points at an EC2 id AWS no longer knows (InvalidInstanceID.NotFound).
   * Callers must mark the Hub VM failed/terminated — never StartInstances.
   */
  ghost?: boolean;
  /** i-* id would have been sent to Azure start — refused (REMINT_PROVIDER_MISMATCH). */
  mismatch?: boolean;
  /**
   * True when the shared budget ran out before StartInstances. `ok` is false
   * and `code` is REMINT_START_FAILED. Callers respond 503 with retryable:true
   * and write nothing: no status change and no clearing of ended_* or expires_at.
   * A cap after StartInstances was accepted is reported by waitForRunningAndIps
   * (status stays starting), not here.
   */
  capped?: boolean;
  code?: "REMINT_START_FAILED";
};

/** Shared clock for the stopped-wait and the running-wait. Both phases draw from one cap. */
export type RemintClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  startedAt: number;
  capMs: number;
};

export type StartCloudDeps = {
  clock?: RemintClock;
  resolveAwsRuntime?: (supabase: SupabaseLike, accountId: string | null) => Promise<{ defaultRegion?: string }>;
  describeAwsInstance?: (
    rt: { defaultRegion?: string },
    instanceId: string,
  ) => Promise<{ state: string; publicIp: string | null; privateIp: string | null }>;
  ec2Action?: (
    rt: { defaultRegion?: string },
    action: string,
    params: Record<string, string>,
  ) => Promise<{ ok: boolean; status: number; text: string; xml: string }>;
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

/**
 * Poll until AWS reports stopped, or the shared remint budget is gone.
 * Does not start its own 90s timer: `clock` is the total budget for both phases.
 */
export async function waitForAwsStoppedWithinBudget(
  describe: () => Promise<{ state: string }>,
  clock: RemintClock,
): Promise<{ state: string; detail?: string; capped?: boolean }> {
  const deadline = clock.startedAt + clock.capMs;
  let last = "stopping";
  while (clock.now() < deadline) {
    const desc = await describe();
    last = desc.state;
    if (desc.state === "stopped") return { state: "stopped" };
    if (desc.state === "terminated" || desc.state === "shutting-down") {
      return { state: desc.state, detail: `instance is ${desc.state} — cannot Start` };
    }
    if (desc.state === "running" || desc.state === "pending") {
      // Leave failed mid-stop / race — treat as already up.
      return { state: desc.state };
    }
    const remaining = deadline - clock.now();
    if (remaining <= 0) break;
    await clock.sleep(Math.min(3_000, remaining));
  }
  const elapsed = clock.now() - clock.startedAt;
  console.warn(JSON.stringify({
    event: "aws_remint_wait_capped",
    phase: "stopped",
    elapsed_ms: elapsed,
    cap_ms: clock.capMs,
    state: last,
  }));
  return { state: last, detail: `timed out waiting for stopped (last=${last})`, capped: true };
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
 * Total edge budget for a persistent AWS remint: wait-until-stopped plus
 * wait-until-running together. Replaces the old 110s running-only cap, which
 * stacked on a separate 90s stopped wait and could pass Supabase's 150s limit.
 */
export const AWS_REMINT_WAIT_CAP_MS = 100_000;

export type WaitForRunningResult = {
  running: boolean;
  state: string;
  publicIp: string | null;
  privateIp: string | null;
  elapsedMs: number;
  /** True when the shared total cap was hit. Callers must not write running or IPs. */
  capped?: boolean;
};

export function createRemintClock(deps?: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  capMs?: number;
}): RemintClock {
  const now = deps?.now ?? Date.now;
  return {
    now,
    sleep: deps?.sleep ?? sleep,
    startedAt: now(),
    capMs: deps?.capMs ?? AWS_REMINT_WAIT_CAP_MS,
  };
}

/**
 * After a successful Start, poll the cloud until Running and return the FRESH
 * IPs. Never reuse a deallocated-era public_ip.
 *
 * AWS time is whatever remains of the shared 100s total (stopped-wait plus
 * this poll). Hitting the cap returns `starting` with null IPs (no running/IP
 * write) and logs the elapsed time from the shared start.
 */
export async function waitForRunningAndIps(
  supabase: SupabaseLike,
  provider: string,
  vm: ResumableVm,
  maxMs = AWS_REMINT_WAIT_CAP_MS,
  deps: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    startedAt?: number;
    describe?: (instanceId: string) => Promise<{ state: string; publicIp: string | null; privateIp: string | null }>;
  } = {},
): Promise<WaitForRunningResult> {
  const now = deps.now ?? Date.now;
  const sleepFn = deps.sleep ?? sleep;
  const started = deps.startedAt ?? now();
  const capMs = Math.min(AWS_REMINT_WAIT_CAP_MS, Math.max(0, maxMs));
  const finish = (
    result: Omit<WaitForRunningResult, "elapsedMs">,
  ): WaitForRunningResult => {
    const elapsedMs = now() - started;
    const payload = {
      event: result.capped ? "aws_remint_wait_capped" : "aws_remint_wait",
      elapsed_ms: elapsedMs,
      cap_ms: capMs,
      state: result.state,
      running: result.running,
    };
    if (result.capped) console.warn(JSON.stringify(payload));
    else console.log(JSON.stringify(payload));
    return { ...result, elapsedMs };
  };

  if (provider !== "aws" || !vm.azure_vm_id) {
    return finish({ running: false, state: "starting", publicIp: null, privateIp: null });
  }

  const describe = deps.describe ?? (async (instanceId: string) => {
    const rt = await resolveAwsRuntime(supabase, vm.provider_account_id);
    if (vm.region) rt.defaultRegion = String(vm.region);
    const d = await describeAwsInstance(rt, instanceId);
    return { state: d.state, publicIp: d.publicIp, privateIp: d.privateIp };
  });

  const deadline = started + capMs;
  while (now() < deadline) {
    const d = await describe(String(vm.azure_vm_id));
    // A describe that finishes after the cap is not a successful promotion.
    if (now() >= deadline) break;
    if (d.state === "running" && d.publicIp) {
      return finish({ running: true, state: d.state, publicIp: d.publicIp, privateIp: d.privateIp });
    }
    if (d.state === "terminated" || d.state === "shutting-down" || d.state === "not-found") {
      return finish({ running: false, state: d.state, publicIp: d.publicIp, privateIp: d.privateIp });
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleepFn(Math.min(4_000, remaining));
  }
  return finish({ running: false, state: "starting", publicIp: null, privateIp: null, capped: true });
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
  deps: StartCloudDeps = {},
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
    // Injected test doubles are not AwsRuntime. Keep the call sites on `any`
    // so a mock clock/describe does not have to satisfy the live client type.
    // deno-lint-ignore no-explicit-any
    const resolveRt: any = deps.resolveAwsRuntime ?? resolveAwsRuntime;
    // deno-lint-ignore no-explicit-any
    const describe: any = deps.describeAwsInstance ?? describeAwsInstance;
    // deno-lint-ignore no-explicit-any
    const ec2: any = deps.ec2Action ?? ec2Action;
    // Callers that also poll for running pass one clock so both phases share 100s.
    // A lone start (no second phase) keeps the historical 90s stopped wait.
    const clock = deps.clock ?? createRemintClock({ capMs: 90_000 });
    try {
      const rt = await resolveRt(supabase, vm.provider_account_id);
      if (vm.region) rt.defaultRegion = String(vm.region);

      const desc0 = await describe(rt, instanceId);
      let state = desc0.state as AwsInstanceState;

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
        const waited = await waitForAwsStoppedWithinBudget(
          async () => {
            const d = await describe(rt, instanceId);
            return { state: d.state };
          },
          clock,
        );
        if (waited.capped) {
          // Budget gone before StartInstances. The instance is still stopped.
          // Do not report success: callers must not write status=starting.
          console.warn(JSON.stringify({
            event: "aws_remint_cap_before_start",
            instance_id: instanceId,
            elapsed_ms: clock.now() - clock.startedAt,
            cap_ms: clock.capMs,
            state: waited.state,
          }));
          return {
            ok: false,
            awsState: waited.state as AwsInstanceState,
            capped: true,
            code: "REMINT_START_FAILED",
            detail: waited.detail ?? "remint wait cap hit before StartInstances",
          };
        }
        if (waited.state === "running" || waited.state === "pending") {
          return { ok: true, awsState: waited.state as AwsInstanceState, detail: `already ${waited.state} after wait` };
        }
        if (waited.state !== "stopped") {
          console.error(`StartInstances wait failed: ${waited.detail}`);
          return { ok: false, awsState: waited.state as AwsInstanceState, detail: waited.detail };
        }
        state = "stopped";
      }

      if (state !== "stopped" && state !== "unknown") {
        const detail = `instance ${instanceId} in unexpected state ${state}`;
        return { ok: false, awsState: state, detail };
      }

      const res = await ec2(rt, "StartInstances", { "InstanceId.1": instanceId });
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
