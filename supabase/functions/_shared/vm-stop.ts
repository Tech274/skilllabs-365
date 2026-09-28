// P2a-0 — Sweep guard. The ONLY place that writes a stop status to
// public.virtual_machines. Stop-only: no TerminateInstances / Azure DELETE.
//
//   protectedVmIds()  — VM_PROTECTED_IDS, matched with the same rules as the
//                       held list (prefix, cloud id, Azure name). Never hardcoded.
//   isSweepExempt()   — protected | persistent_in_window (one helper, no copies).
//   auditSweep()      — admin_audit_logs + provisioning_events, throttled.
//   stopVmHonest()    — refuses a guarded VM before any cloud call. Otherwise
//                       cloud stop → describe → write status ONLY when the
//                       cloud is FINAL: AWS "stopped", Azure "deallocated".
//                       Azure "stopped" is still allocated and stays pending.

import { resolveAzureRuntime } from "./cloud-providers/azure-runtime.ts";
import { resolveAwsRuntime, stopAwsInstance, describeAwsInstance } from "./cloud-providers/aws-runtime.ts";
import { fetchInstanceViewStatuses } from "./azure-reconcile.ts";
import { buildWalletSnapshot } from "./lab-wallet.ts";
import { recordAudit } from "./admin-audit.ts";
import { isVmGuarded, loadVmGuardLists } from "./lab-expiry.ts";

// deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
type Admin = any;

export interface AzureCtx { token: string; subscriptionId: string; resourceGroup: string }
export type AzureResolver = (accountId?: string | null) => Promise<AzureCtx>;

export interface SweepVm {
  id: string;
  azure_vm_id?: string | null;
  status?: string | null;
  user_id?: string | null;
  lab_template_id?: string | null;
  provider_account_id?: string | null;
  region?: string | null;
}

// ---------------------------------------------------------------- cloud utils

export async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Per-request cache of Azure contexts keyed by provider account. */
export function makeAzureResolver(admin: Admin): AzureResolver {
  const cache = new Map<string, Promise<AzureCtx>>();
  return (accountId?: string | null) => {
    const key = accountId ?? "__default__";
    let entry = cache.get(key);
    if (!entry) {
      entry = (async () => {
        const rt = await resolveAzureRuntime(admin, accountId ?? null);
        const token = await getAzureToken(rt.tenantId, rt.clientId, rt.clientSecret);
        return { token, subscriptionId: rt.subscriptionId, resourceGroup: rt.resourceGroup };
      })();
      cache.set(key, entry);
    }
    return entry;
  };
}

export function extractVmName(azureVmId: string): string {
  return azureVmId.includes("/") ? azureVmId.split("/").pop()! : azureVmId;
}

/** Provider for a VM: account provider first, then EC2 "i-" id heuristic, else azure. */
export async function providerOf(
  admin: Admin,
  accountId?: string | null,
  azureVmId?: string | null,
): Promise<"azure" | "aws" | string> {
  if (accountId) {
    const { data } = await admin.from("cloud_provider_accounts").select("provider").eq("id", accountId).maybeSingle();
    if (data?.provider) return String(data.provider);
  }
  if (azureVmId && /^i-[0-9a-f]+$/i.test(azureVmId)) return "aws";
  return "azure";
}

// ------------------------------------------------------------ protected list

let emptyLoggedAt = 0;

/**
 * Protected + held guard. Matching is the shared union helper (UUID, 8+ hex
 * prefix, cloud id, Azure name) against BOTH `VM_PROTECTED_IDS` and
 * `CLEANUP_HELD_VM_IDS`, plus the built-in smoke prefix.
 *
 * Pass `{ log: true }` once at the start of a run: logs VM_PROTECTED_IDS_EMPTY
 * (at most once per run) when VM_PROTECTED_IDS is empty/unset. The held list
 * and built-in smoke id still guard VMs in that case.
 */
export function protectedVmIds(opts: { log?: boolean } = {}): Set<string> {
  const lists = loadVmGuardLists();
  if (opts.log && lists.protectedEntries.length === 0) {
    const now = Date.now();
    if (now - emptyLoggedAt > 1000) {
      console.error("VM_PROTECTED_IDS_EMPTY");
      emptyLoggedAt = now;
    }
  }
  return new Set(lists.protectedEntries);
}

export function vmIsGuarded(vm: { id?: string | null; azure_vm_id?: string | null }): boolean {
  return isVmGuarded(vm);
}

export type SweepExempt = { exempt: boolean; reason?: "protected" | "persistent_in_window" };

/** One exemption helper for every automatic sweep path. Call it FIRST. */
export async function isSweepExempt(admin: Admin, vm: SweepVm, nowMs: number = Date.now()): Promise<SweepExempt> {
  if (isVmGuarded(vm)) return { exempt: true, reason: "protected" };
  if (!vm.lab_template_id) return { exempt: false };
  const { data: tpl } = await admin
    .from("lab_templates")
    .select("id, duration, is_persistent, end_date")
    .eq("id", vm.lab_template_id)
    .maybeSingle();
  if (!tpl?.is_persistent) return { exempt: false };
  let sessions: Array<{ started_at?: string | null; ended_at?: string | null }> = [];
  if (vm.user_id) {
    const { data } = await admin
      .from("sessions")
      .select("started_at, ended_at")
      .eq("user_id", vm.user_id)
      .eq("lab_template_id", vm.lab_template_id)
      .limit(500);
    sessions = data ?? [];
  }
  const snap = buildWalletSnapshot({
    duration: tpl.duration,
    endDate: tpl.end_date,
    isPersistent: tpl.is_persistent,
    sessions,
    nowMs,
  });
  if (!snap.windowEnded && !snap.exhausted) return { exempt: true, reason: "persistent_in_window" };
  return { exempt: false };
}

// ------------------------------------------------------------------- audit

export interface SweepAudit {
  actorId?: string | null;
  actorType: "cron" | "watchdog" | "user" | "system";
  source: string;
  vm: SweepVm;
  action: "vm.stop" | "vm.stop_skipped" | "vm.delete_skipped" | "vm.terminate_blocked";
  result: "stopped" | "skipped" | "failed" | "blocked" | "pending";
  reason: string;
  priorStatus?: string | null;
  cloudState?: string | null;
  error?: string | null;
  correlationId?: string | null;
  dryRun?: boolean;
}

const THROTTLE_MS = 60 * 60 * 1000;

export async function auditSweep(admin: Admin, a: SweepAudit): Promise<void> {
  if (a.dryRun) return;
  try {
    if (a.result === "skipped" || a.result === "failed" || a.result === "pending") {
      const since = new Date(Date.now() - THROTTLE_MS).toISOString();
      const { data: recent } = await admin
        .from("admin_audit_logs")
        .select("id")
        .eq("entity_id", a.vm.id)
        .eq("action", a.action)
        .filter("changes->>reason", "eq", a.reason)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (recent && recent.length) return;
    }
    const changes = {
      source: a.source,
      vm_id: a.vm.id,
      provider_id: a.vm.azure_vm_id ?? null,
      result: a.result === "pending" ? "stopping" : a.result,
      reason: a.reason,
      prior_status: a.priorStatus ?? a.vm.status ?? null,
      cloud_state: a.cloudState ?? null,
      error: a.error ? String(a.error).slice(0, 500) : null,
    };
    await recordAudit(admin, {
      actorId: a.actorId ?? null,
      actorType: a.actorType,
      action: a.action,
      entityType: "virtual_machine",
      entityId: a.vm.id,
      entityLabel: a.vm.azure_vm_id ?? null,
      // deno-lint-ignore no-explicit-any -- "pending" is a valid outcome value (no DB check constraint)
      outcome: (a.result === "stopped" ? "success" : a.result === "failed" ? "failed" : a.result === "pending" ? "pending" : "blocked") as any,
      changes,
      message: a.reason,
      correlationId: a.correlationId ?? null,
    });
    await admin.from("provisioning_events").insert({
      correlation_id: a.correlationId ?? `sweep_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      vm_id: a.vm.id,
      user_id: a.vm.user_id ?? null,
      lab_template_id: a.vm.lab_template_id ?? null,
      source: a.source,
      step: "sweep-stop",
      status: a.result === "stopped" ? "success" : a.result === "failed" ? "failed" : "skipped",
      message: a.reason,
      detail: changes,
    });
  } catch (e) {
    console.error("auditSweep failed:", e instanceof Error ? e.message : e);
  }
}

// -------------------------------------------------------------- honest stop

// FINAL states only — a stop is confirmed (and the Hub status written) ONLY
// when the cloud reports one of these. "stopping"/"deallocating" = accepted,
// NOT confirmed: keep polling.
export const AWS_FINAL = new Set(["stopped"]);
// Azure "stopped" is PowerState/stopped: the guest is down but the VM is still
// allocated and still billing. Only "deallocated" confirms a deallocate.
export const AZURE_FINAL = new Set(["deallocated"]);
export const AWS_PENDING = new Set(["stopping"]);
export const AZURE_PENDING = new Set(["deallocating", "stopping", "stopped"]);

export const POLL_INTERVAL_MS = 3_000;
export const PER_VM_POLL_CAP_MS = 30_000;
export const INVOCATION_POLL_BUDGET_MS = 90_000;

export function isFinalStopState(provider: string, state: string | null | undefined): boolean {
  const finals = provider === "aws" ? AWS_FINAL : AZURE_FINAL;
  return finals.has(String(state));
}

export function isPendingStopState(provider: string, state: string | null | undefined): boolean {
  const pendings = provider === "aws" ? AWS_PENDING : AZURE_PENDING;
  return pendings.has(String(state));
}

/**
 * A stop is confirmed ONLY for a final cloud state. Transitional states
 * (stopping / deallocating) are pending — never success. Anything else is a
 * failure (also not success).
 */
export function interpretStopConfirm(
  provider: string,
  cloudState: string | null,
  stopError?: string,
): { ok: boolean; pending?: boolean; cloudState: string | null; error?: string } {
  if (isFinalStopState(provider, cloudState)) {
    return { ok: true, cloudState };
  }
  if (!stopError && isPendingStopState(provider, cloudState)) {
    return { ok: false, pending: true, cloudState, error: `cloud state after stop: ${cloudState} (pending)` };
  }
  return { ok: false, cloudState, error: stopError ?? `cloud state after stop: ${cloudState}` };
}

/**
 * Shared polling budget for one function invocation. Create once per run and
 * pass to every stopVmHonest call; once spent, remaining VMs get a single
 * Describe and no wait.
 */
export interface StopPollBudget { remainingMs: number }
export function newStopPollBudget(ms: number = INVOCATION_POLL_BUDGET_MS): StopPollBudget {
  return { remainingMs: ms };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Describe the cloud power state without changing it. */
export async function describeCloudState(admin: Admin, azureFor: AzureResolver, vm: SweepVm): Promise<string> {
  if (!vm.azure_vm_id) return "no_instance";
  const provider = await providerOf(admin, vm.provider_account_id, vm.azure_vm_id);
  if (provider === "aws") {
    const aws = await resolveAwsRuntime(admin, vm.provider_account_id);
    if (vm.region) aws.defaultRegion = String(vm.region);
    return (await describeAwsInstance(aws, vm.azure_vm_id)).state;
  }
  const az = await azureFor(vm.provider_account_id);
  const statuses = await fetchInstanceViewStatuses(az, extractVmName(vm.azure_vm_id));
  if (!statuses) return "unavailable";
  const power = statuses.map((s) => s.code || "").find((c) => c.startsWith("PowerState/"));
  if (power) return power.slice("PowerState/".length);
  const prov = statuses.map((s) => s.code || "").find((c) => c.startsWith("ProvisioningState/"));
  return prov ? prov.slice("ProvisioningState/".length) : "unknown";
}

/**
 * Poll until a FINAL state, the per-VM cap (30s), or the shared invocation
 * budget runs out. Returns the last seen state. Injectable clock/sleep/describe
 * so tests can prove a timeout stays pending and never looks like success.
 */
export async function pollCloudUntilFinal(args: {
  provider: string;
  budget: StopPollBudget;
  describe: () => Promise<string | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string | null> {
  const now = args.now ?? Date.now;
  const sleepFn = args.sleep ?? sleep;
  const startedAt = now();
  let state: string | null = null;
  for (;;) {
    try {
      state = await args.describe();
    } catch {
      return state;
    }
    if (isFinalStopState(args.provider, state)) return state;
    const elapsed = now() - startedAt;
    const wait = Math.min(POLL_INTERVAL_MS, PER_VM_POLL_CAP_MS - elapsed, args.budget.remainingMs);
    if (wait <= 0) return state;
    args.budget.remainingMs -= wait;
    await sleepFn(wait);
  }
}

/**
 * Poll the cloud state every 3s until a FINAL state, the per-VM cap (30s), or
 * the shared invocation budget runs out. Returns the last seen state.
 */
async function pollCloudStateUntilFinal(
  admin: Admin,
  azureFor: AzureResolver,
  vm: SweepVm,
  provider: string,
  budget: StopPollBudget,
): Promise<string | null> {
  return pollCloudUntilFinal({
    provider,
    budget,
    describe: () => describeCloudState(admin, azureFor, vm),
  });
}

export async function stopVmHonest(
  admin: Admin,
  azureFor: AzureResolver,
  vm: SweepVm,
  opts: { finalStatus: "deallocated" | "failed"; reason: string; endedBy: string },
  budget: StopPollBudget = newStopPollBudget(), // default: full poll budget per call
): Promise<{ ok: boolean; pending?: boolean; cloudState: string | null; error?: string; code?: "VM_PROTECTED" }> {
  // Inside the writer, not only at the call site, so no caller can bypass it.
  if (isVmGuarded(vm)) {
    return { ok: false, cloudState: null, error: "VM_PROTECTED", code: "VM_PROTECTED" };
  }
  if (!vm.azure_vm_id) return { ok: false, cloudState: "no_instance", error: "VM has no cloud instance id" };
  const provider = await providerOf(admin, vm.provider_account_id, vm.azure_vm_id);
  let stopError: string | undefined;
  let cloudState: string | null = null;

  try {
    if (provider === "aws") {
      const aws = await resolveAwsRuntime(admin, vm.provider_account_id);
      if (vm.region) aws.defaultRegion = String(vm.region);
      try {
        await stopAwsInstance(aws, vm.azure_vm_id);
      } catch (e) {
        stopError = e instanceof Error ? e.message : String(e);
      }
    } else {
      const az = await azureFor(vm.provider_account_id);
      const name = extractVmName(vm.azure_vm_id);
      const res = await fetch(
        `https://management.azure.com/subscriptions/${az.subscriptionId}/resourceGroups/${az.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${name}/deallocate?api-version=2024-03-01`,
        { method: "POST", headers: { Authorization: `Bearer ${az.token}` } },
      );
      if (!res.ok) stopError = `azure deallocate ${res.status}: ${(await res.text()).slice(0, 300)}`;
      else await res.body?.cancel();
    }
  } catch (e) {
    return { ok: false, cloudState, error: stopError ?? (e instanceof Error ? e.message : String(e)) };
  }

  cloudState = await pollCloudStateUntilFinal(admin, azureFor, vm, provider, budget);

  const verdict = interpretStopConfirm(provider, cloudState, stopError);
  if (!verdict.ok) {
    // Pending (stopping/deallocating, or the poll budget ran out on a
    // transitional state): NO status write. The next sweep re-stops
    // idempotently and writes only on a final state.
    return verdict;
  }

  const patch: Record<string, unknown> = {
    status: opts.finalStatus,
    ended_by: opts.endedBy,
    ended_reason: opts.reason,
    ended_at: new Date().toISOString(),
  };
  if (provider === "aws") patch.public_ip = null;
  // H1: any successful stop clears a leftover stop_pending marker.
  const { data: cur } = await admin.from("virtual_machines").select("network_info").eq("id", vm.id).maybeSingle();
  if (cur?.network_info && typeof cur.network_info === "object" && cur.network_info.stop_pending) {
    const ni = { ...cur.network_info };
    delete ni.stop_pending;
    patch.network_info = ni;
  }
  const { error } = await admin.from("virtual_machines").update(patch).eq("id", vm.id);
  if (error) return { ok: false, cloudState, error: `db write failed: ${error.message}` };
  return { ok: true, cloudState };
}

/**
 * H1: stop accepted but not confirmed. Merge network_info.stop_pending so
 * vm-reconcile finalises it as the Hub stop (not an external stop). No status write.
 */
export async function markStopPending(admin: Admin, vmId: string, sp: { reason: string; by: string | null }): Promise<void> {
  try {
    const { data: cur } = await admin.from("virtual_machines").select("network_info").eq("id", vmId).maybeSingle();
    const ni = cur?.network_info && typeof cur.network_info === "object" ? cur.network_info : {};
    await admin.from("virtual_machines").update({
      network_info: { ...ni, stop_pending: { at: new Date().toISOString(), reason: sp.reason, by: sp.by } },
    }).eq("id", vmId);
  } catch (e) {
    console.error("markStopPending failed:", e instanceof Error ? e.message : e);
  }
}

/** G3: audit result for a stopVmHonest outcome. pending never audits as failed. */
export function stopAuditResult(res: { ok: boolean; pending?: boolean }): "stopped" | "pending" | "failed" {
  return res.ok ? "stopped" : res.pending ? "pending" : "failed";
}

/**
 * Ghost reconcile: the cloud CONFIRMS the instance is gone (terminated /
 * not-found). Writes failed without any cloud call. Kept here so vm-stop.ts
 * stays the only writer of stop statuses.
 */
export async function markVmGone(
  admin: Admin,
  vm: SweepVm,
  opts: { cloudState: string; reason: string; endedBy: string },
): Promise<boolean> {
  if (!["terminated", "shutting-down", "not-found", "failed"].includes(opts.cloudState)) return false;
  const { error } = await admin.from("virtual_machines").update({
    status: "failed",
    ended_by: opts.endedBy,
    ended_reason: opts.reason,
    ended_at: new Date().toISOString(),
  }).eq("id", vm.id);
  return !error;
}

// ---------------------------------------------------------------- scoping

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse only_vm_ids: uuid[] (null when absent). Throws on invalid input. */
export function parseOnlyVmIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !UUID.test(v))) {
    throw new Error("only_vm_ids must be an array of UUIDs");
  }
  return raw as string[];
}

export interface DryRunReport {
  would_stop: Array<{ vm_id: string; reason: string }>;
  would_skip: Array<{ vm_id: string; reason: string }>;
  would_fail_select: Array<{ path: string; error: string }>;
}

export function newDryRunReport(): DryRunReport {
  return { would_stop: [], would_skip: [], would_fail_select: [] };
}
