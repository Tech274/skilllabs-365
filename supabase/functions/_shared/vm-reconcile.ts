// P2a — Hub virtual_machines.status + public_ip must match provider truth.
//
// reconcileVms() is READ-ONLY toward the cloud (Describe / instanceView only —
// never Start/Stop/SSM). It maps provider state → Hub row and writes ONLY when
// something actually changed (idempotent; safe to poll every 4s).
//
// Provider is resolved via resolveRemintProvider (account → template → cloud id),
// never the lone vm.provider stamp.

import { ec2Action, describeAwsInstance, parseAwsPublicIpFromXml, resolveAwsRuntime, type AwsInstanceState } from "./cloud-providers/aws-runtime.ts";
import { resolveRemintProvider } from "./cloud-providers/vm-resume.ts";
import { reconcileProvisioningAgainstAzure, applyPromoteToRunning } from "./azure-reconcile.ts";
import { makeAzureResolver, type AzureResolver } from "./vm-stop.ts";
import { isVmGuarded } from "./lab-expiry.ts";
import { recordAudit } from "./admin-audit.ts";

// deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
type Admin = any;

export const VM_RECONCILE_COLS =
  "id, user_id, lab_template_id, azure_vm_id, status, provider_account_id, region, public_ip, private_ip, updated_at, network_info, ended_reason, ended_by";

export interface ReconcileVm {
  id: string;
  status: string;
  azure_vm_id: string | null;
  provider_account_id?: string | null;
  lab_template_id?: string | null;
  user_id?: string | null;
  region?: string | null;
  public_ip?: string | null;
  private_ip?: string | null;
  updated_at?: string | null;
  // deno-lint-ignore no-explicit-any
  network_info?: any;
  ended_reason?: string | null;
  ended_by?: string | null;
}

export interface HubSnap { status: string; public_ip: string | null; private_ip: string | null }

export interface ReconcileResult {
  vm_id: string;
  provider: "aws" | "azure" | null;
  cloud_state: string | null;
  before: HubSnap;
  after: HubSnap;
  changed: boolean;
  code?: string;
  /** Present when drift was computed but not written (dry-run / protected / failed-row). */
  would_be?: HubSnap;
}

export interface ReconcileOpts {
  source: string;
  dryRun?: boolean;
  azureFor?: AzureResolver;
  /**
   * Test seam. When set, live AWS Describe is not called. Production callers
   * omit this.
   */
  awsDescribe?: (
    accountId: string | null,
    region: string | null,
    ids: string[],
  ) => Promise<Map<string, { state: AwsInstanceState | "unavailable"; privateIp: string | null; publicIp: string | null; error?: string }>>;
}

const START_HOLD_MS = 3 * 60_000;
const STOP_PENDING_FRESH_MS = 15 * 60_000;
const HUB_LIVE = new Set(["running", "idle", "starting", "provisioning"]);
const PROMOTABLE = new Set(["provisioning", "starting"]);

/**
 * Writes (including provisioning/starting → running promotions) happen only
 * when an operator opts in. Default, unset, and `VM_RECONCILE_DRY_RUN=true`
 * are dry-run. Opt in with `VM_RECONCILE_MODE=apply` or
 * `VM_RECONCILE_DRY_RUN=false`. An explicit `VM_RECONCILE_MODE=dry-run` wins
 * over `VM_RECONCILE_DRY_RUN=false`.
 */
export function reconcileWritesEnabled(env?: { mode?: string | null; dryRun?: string | null }): boolean {
  const mode = String(env?.mode ?? Deno.env.get("VM_RECONCILE_MODE") ?? "").trim().toLowerCase();
  if (mode === "dry-run") return false;
  if (mode === "apply") return true;
  const dry = String(env?.dryRun ?? Deno.env.get("VM_RECONCILE_DRY_RUN") ?? "").trim().toLowerCase();
  return dry === "false";
}

/** Body `dry_run: true` or caller `dryRun: true` forces a report. Otherwise follow the env opt-in. */
export function effectiveReconcileDryRun(opts: { dryRun?: boolean; bodyDryRun?: boolean } = {}): boolean {
  if (opts.dryRun === true || opts.bodyDryRun === true) return true;
  return !reconcileWritesEnabled();
}

export function envDryRun(): boolean {
  return !reconcileWritesEnabled();
}

/**
 * Dry-run reports drift and performs NO writes, promotions included.
 * `promote` is accepted so callers cannot special-case it back on.
 */
export function reconcilePersistence(args: {
  dryRun: boolean;
  drift: boolean;
  protected: boolean;
  code?: string;
  promote?: boolean;
}): "unchanged" | "protected" | "failed_row" | "dry_run" | "write" {
  if (!args.drift) return "unchanged";
  if (args.protected) return "protected";
  if (args.code === "VM_FAILED_ROW_RUNNING") return "failed_row";
  if (args.dryRun) return "dry_run";
  return "write";
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ------------------------------------------------------------ AWS batch describe

type AwsDesc = { state: AwsInstanceState | "unavailable"; privateIp: string | null; publicIp: string | null; error?: string };

function parseBatch(xml: string, ids: string[]): Map<string, AwsDesc> {
  const out = new Map<string, AwsDesc>();
  const marks: Array<{ id: string; at: number }> = [];
  const re = /<instanceId>(i-[0-9a-f]+)<\/instanceId>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) marks.push({ id: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const chunk = xml.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : xml.length);
    const state = (chunk.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/)?.[1] ?? "unknown") as AwsInstanceState;
    const priv = chunk.match(/<privateIpAddress>([^<]*)<\/privateIpAddress>/)?.[1] || null;
    if (!out.has(marks[i].id)) out.set(marks[i].id, { state, privateIp: priv, publicIp: parseAwsPublicIpFromXml(chunk) });
  }
  for (const id of ids) {
    // Explicit-id Describe never silently omits; a gap means we cannot tell → never guess.
    if (!out.has(id)) out.set(id, { state: "unavailable", privateIp: null, publicIp: null, error: "missing from Describe response" });
  }
  return out;
}

/** DescribeInstances for up to 100 ids per call, backing off on RequestLimitExceeded. */
async function describeAwsBatch(admin: Admin, accountId: string | null, region: string | null, ids: string[]): Promise<Map<string, AwsDesc>> {
  const out = new Map<string, AwsDesc>();
  let rt;
  try {
    rt = await resolveAwsRuntime(admin, accountId);
    if (region) rt.defaultRegion = region;
  } catch (e) {
    for (const id of ids) out.set(id, { state: "unavailable", privateIp: null, publicIp: null, error: e instanceof Error ? e.message : String(e) });
    return out;
  }
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const params: Record<string, string> = {};
    chunk.forEach((id, n) => { params[`InstanceId.${n + 1}`] = id; });
    let res: { ok: boolean; status: number; text: string; xml: string } | null = null;
    let err: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await ec2Action(rt, "DescribeInstances", params);
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
        res = null;
        break;
      }
      if (!res.ok && /RequestLimitExceeded|Throttling/i.test(res.text) && attempt < 3) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (res?.ok) {
      for (const [k, v] of parseBatch(res.xml, chunk)) out.set(k, v);
      continue;
    }
    if (res && /InvalidInstanceID\.(NotFound|Malformed)/i.test(res.text)) {
      // One bad id fails the whole batch — fall back per id (describeAwsInstance maps NotFound).
      for (const id of chunk) {
        try {
          const d = await describeAwsInstance(rt, id);
          out.set(id, { state: d.state, privateIp: d.privateIp, publicIp: d.publicIp });
        } catch (e) {
          out.set(id, { state: "unavailable", privateIp: null, publicIp: null, error: e instanceof Error ? e.message : String(e) });
        }
      }
      continue;
    }
    const detail = err ?? `DescribeInstances ${res?.status}: ${(res?.text ?? "").slice(0, 200)}`;
    for (const id of chunk) out.set(id, { state: "unavailable", privateIp: null, publicIp: null, error: detail });
  }
  return out;
}

// ------------------------------------------------------------------ notify

async function notifyLearnerAndAdmins(admin: Admin, opts: { userId?: string | null; type: string; title: string; message: string }) {
  try {
    const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const recipients = new Set<string>((adminRoles ?? []).map((r: { user_id: string }) => r.user_id));
    if (opts.userId) recipients.add(opts.userId);
    if (!recipients.size) return;
    await admin.from("notifications").insert([...recipients].map((uid) => ({
      user_id: uid, type: opts.type, title: opts.title, message: opts.message,
    })));
  } catch (e) {
    console.error("vm-reconcile notify failed:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------- decision

type Plan = {
  cloud_state: string;
  code?: string;
  /** Status-level target (undefined = keep). */
  status?: string;
  public_ip?: string | null; // undefined = keep
  private_ip?: string | null;
  promote?: boolean; // use applyPromoteToRunning
  endedReason?: string;
  finaliseHubStop?: { reason: string; by: string | null };
  externalKind?: "vm.external_stop" | "vm.external_terminate";
};

function stopPendingFresh(vm: ReconcileVm, nowMs: number): { reason: string; by: string | null } | null {
  const sp = vm.network_info && typeof vm.network_info === "object" ? vm.network_info.stop_pending : null;
  if (!sp || !sp.at) return null;
  const at = Date.parse(String(sp.at));
  if (!Number.isFinite(at) || nowMs - at > STOP_PENDING_FRESH_MS) return null;
  return { reason: String(sp.reason ?? "hub_stop"), by: sp.by ? String(sp.by) : null };
}

function cancelRequested(vm: ReconcileVm): boolean {
  return !!(vm.network_info && typeof vm.network_info === "object" && vm.network_info.cancel_requested_at);
}

function inStartHold(vm: ReconcileVm, nowMs: number): boolean {
  if (vm.status !== "starting") return false;
  const u = vm.updated_at ? Date.parse(vm.updated_at) : NaN;
  return Number.isFinite(u) && nowMs - u < START_HOLD_MS;
}

/** Hub → stopped-ish transition for a cloud-confirmed stop. `final` is false for Azure stopped. */
export function planStop(vm: ReconcileVm, cloud: string, target: "stopped" | "deallocated", nowMs: number, final: boolean): Plan {
  if (vm.status === "starting" && inStartHold(vm, nowMs)) return { cloud_state: cloud, code: "START_IN_FLIGHT_HOLD" };
  if (!HUB_LIVE.has(vm.status)) return { cloud_state: cloud }; // already deallocated|stopped|failed → no status change
  const hubStop = stopPendingFresh(vm, nowMs);
  if (hubStop) {
    // H1: Hub initiated this stop; finalise it as the Hub stop once cloud is final.
    if (!final) return { cloud_state: cloud, code: "HUB_STOP_PENDING" };
    return { cloud_state: cloud, status: "deallocated", finaliseHubStop: hubStop };
  }
  return { cloud_state: cloud, status: target, endedReason: "external_stop", externalKind: "vm.external_stop" };
}

function planAws(vm: ReconcileVm, d: AwsDesc, nowMs: number): Plan {
  const s = d.state;
  if (s === "unavailable") return { cloud_state: "unavailable", code: "VM_RECONCILE_CLOUD_UNAVAILABLE" };
  if (s === "running") {
    if (vm.status === "failed") return { cloud_state: s, code: "VM_FAILED_ROW_RUNNING", status: "running", public_ip: d.publicIp, private_ip: d.privateIp };
    if (cancelRequested(vm)) return { cloud_state: s, code: "CANCEL_REQUESTED_NO_PROMOTE" };
    if (vm.status === "running" || vm.status === "idle") return { cloud_state: s, public_ip: d.publicIp, private_ip: d.privateIp };
    return { cloud_state: s, status: "running", public_ip: d.publicIp, private_ip: d.privateIp, promote: true };
  }
  if (s === "pending") {
    if (vm.status === "failed") return { cloud_state: s, code: "VM_FAILED_ROW_RUNNING" };
    if (cancelRequested(vm)) return { cloud_state: s, public_ip: d.publicIp, private_ip: d.privateIp };
    return { cloud_state: s, status: "starting", public_ip: d.publicIp, private_ip: d.privateIp };
  }
  if (s === "stopping" || s === "stopped") {
    const p = planStop(vm, s, "stopped", nowMs, s === "stopped");
    // Hold means StartInstances in flight — the IP is about to be re-read; do not clear it mid-start.
    if (p.code !== "START_IN_FLIGHT_HOLD") p.public_ip = null;
    return p;
  }
  if (s === "shutting-down" || s === "terminated" || s === "not-found") {
    const reason = s === "not-found" ? "ghost_instance_not_found" : "external_terminate";
    if (vm.status === "failed") return { cloud_state: s, public_ip: null };
    return {
      cloud_state: s, status: "failed", public_ip: null, endedReason: reason,
      externalKind: HUB_LIVE.has(vm.status) ? "vm.external_terminate" : undefined,
    };
  }
  return { cloud_state: s, public_ip: null };
}

// deno-lint-ignore no-explicit-any
export function planAzure(vm: ReconcileVm, outcome: any, nowMs: number): Plan {
  if (outcome.kind === "azure_unavailable") return { cloud_state: "unavailable", code: "VM_RECONCILE_CLOUD_UNAVAILABLE" };
  if (outcome.kind === "still_provisioning") return { cloud_state: "transitional" };
  if (outcome.kind === "promoted") {
    // Static PIP: never null an Azure public_ip because a read came back empty.
    const pub = outcome.public_ip ?? undefined;
    const priv = outcome.private_ip ?? undefined;
    if (vm.status === "failed") return { cloud_state: "running", code: "VM_FAILED_ROW_RUNNING", status: "running", public_ip: pub, private_ip: priv };
    if (cancelRequested(vm)) return { cloud_state: "running", code: "CANCEL_REQUESTED_NO_PROMOTE" };
    if (vm.status === "running" || vm.status === "idle") return { cloud_state: "running", public_ip: pub, private_ip: priv };
    return { cloud_state: "running", status: "running", public_ip: pub, private_ip: priv, promote: true };
  }
  if (outcome.kind === "mapped") {
    const st = String(outcome.status);
    // Same mapping as stop-confirm: only deallocated is final. stopped is still
    // allocated, so a fresh Hub stop stays pending and is not written deallocated.
    if (st === "deallocated") return planStop(vm, st, "deallocated", nowMs, true);
    if (st === "stopped") return planStop(vm, st, "stopped", nowMs, false);
    if (st === "failed") {
      if (vm.status === "failed") return { cloud_state: st };
      return { cloud_state: st, status: "failed", endedReason: "external_terminate", externalKind: HUB_LIVE.has(vm.status) ? "vm.external_terminate" : undefined };
    }
  }
  return { cloud_state: String(outcome.kind) };
}

// ----------------------------------------------------------------- main

export async function reconcileVms(admin: Admin, vms: ReconcileVm[], opts: ReconcileOpts): Promise<ReconcileResult[]> {
  // Caller `dryRun: true` forces a report. `dryRun: false` does NOT opt in by
  // itself — writes still require VM_RECONCILE_MODE=apply or VM_RECONCILE_DRY_RUN=false.
  const dryRun = effectiveReconcileDryRun({ dryRun: opts.dryRun === true ? true : undefined });
  const azureFor = opts.azureFor ?? makeAzureResolver(admin);
  const nowMs = Date.now();
  const rows = vms.filter((v) => v && v.id && v.azure_vm_id);

  // Provider resolve inputs (batch).
  const acctIds = [...new Set(rows.map((v) => v.provider_account_id).filter(Boolean))] as string[];
  const tplIds = [...new Set(rows.map((v) => v.lab_template_id).filter(Boolean))] as string[];
  const acctProv = new Map<string, string>();
  const tplProv = new Map<string, string>();
  if (acctIds.length) {
    const { data } = await admin.from("cloud_provider_accounts").select("id, provider").in("id", acctIds);
    for (const a of data ?? []) acctProv.set(a.id, String(a.provider));
  }
  if (tplIds.length) {
    const { data } = await admin.from("lab_templates").select("id, provider").in("id", tplIds);
    for (const t of data ?? []) if (t.provider) tplProv.set(t.id, String(t.provider));
  }
  const providerFor = (v: ReconcileVm) => resolveRemintProvider({
    accountProvider: v.provider_account_id ? acctProv.get(v.provider_account_id) : null,
    templateProvider: v.lab_template_id ? tplProv.get(v.lab_template_id) : null,
    cloudId: v.azure_vm_id,
  });

  // AWS: group by account+region, batch Describe.
  const awsGroups = new Map<string, { acct: string | null; region: string | null; ids: string[] }>();
  const provMap = new Map<string, "aws" | "azure">();
  for (const v of rows) {
    const r = providerFor(v);
    // Fail closed on mismatch: an i-* id is EC2 regardless of a stale azure stamp.
    const p: "aws" | "azure" = r.mismatch ? "aws" : r.provider;
    provMap.set(v.id, p);
    if (p !== "aws") continue;
    const key = `${v.provider_account_id ?? ""}|${v.region ?? ""}`;
    const g = awsGroups.get(key) ?? { acct: v.provider_account_id ?? null, region: v.region ?? null, ids: [] };
    g.ids.push(String(v.azure_vm_id));
    awsGroups.set(key, g);
  }
  const awsDesc = new Map<string, AwsDesc>();
  for (const g of awsGroups.values()) {
    const ids = [...new Set(g.ids)];
    const res = opts.awsDescribe
      ? await opts.awsDescribe(g.acct, g.region, ids)
      : await describeAwsBatch(admin, g.acct, g.region, ids);
    for (const [k, v] of res) awsDesc.set(`${g.acct ?? ""}|${g.region ?? ""}|${k}`, v);
  }

  const results: ReconcileResult[] = [];
  for (const vm of rows) {
    const provider = provMap.get(vm.id) ?? null;
    const before: HubSnap = { status: vm.status, public_ip: vm.public_ip ?? null, private_ip: vm.private_ip ?? null };
    let plan: Plan;
    try {
      if (provider === "aws") {
        const d = awsDesc.get(`${vm.provider_account_id ?? ""}|${vm.region ?? ""}|${vm.azure_vm_id}`) ??
          { state: "unavailable", privateIp: null, publicIp: null } as AwsDesc;
        plan = planAws(vm, d, nowMs);
      } else {
        const az = await azureFor(vm.provider_account_id);
        const outcome = await reconcileProvisioningAgainstAzure(az, { azureVmId: vm.azure_vm_id, currentPrivateIp: vm.private_ip ?? null, publicIpRetryMs: 0 });
        plan = planAzure(vm, outcome, nowMs);
      }
    } catch (e) {
      console.error(`[vm-reconcile] ${vm.id} cloud read failed:`, e instanceof Error ? e.message : e);
      plan = { cloud_state: "unavailable", code: "VM_RECONCILE_CLOUD_UNAVAILABLE" };
    }

    const after: HubSnap = {
      status: plan.status ?? before.status,
      public_ip: plan.public_ip === undefined ? before.public_ip : plan.public_ip,
      private_ip: plan.private_ip === undefined || plan.private_ip === null ? before.private_ip : plan.private_ip,
    };
    const drift = after.status !== before.status || after.public_ip !== before.public_ip || after.private_ip !== before.private_ip;
    const base = { vm_id: vm.id, provider, cloud_state: plan.cloud_state, before };

    if (plan.code === "VM_RECONCILE_CLOUD_UNAVAILABLE") {
      results.push({ ...base, after: before, changed: false, code: plan.code });
      continue;
    }
    if (!drift) {
      results.push({ ...base, after: before, changed: false, ...(plan.code ? { code: plan.code } : {}) });
      continue;
    }
    const isPromotion = plan.promote === true && PROMOTABLE.has(vm.status);
    const persistence = reconcilePersistence({
      dryRun,
      drift,
      protected: isVmGuarded(vm),
      code: plan.code,
      promote: isPromotion,
    });
    if (persistence === "protected") {
      results.push({ ...base, after: before, changed: false, code: "VM_PROTECTED_READONLY", would_be: after });
      continue;
    }
    if (persistence === "failed_row") {
      results.push({ ...base, after: before, changed: false, code: plan.code, would_be: after });
      continue;
    }
    // Dry-run: NO writes at all, including promotions.
    if (persistence === "dry_run") {
      results.push({ ...base, after: before, changed: false, code: plan.code ?? "VM_RECONCILE_DRY_RUN", would_be: after });
      continue;
    }

    // ---- write ----
    let ok = true;
    const nowIso = new Date().toISOString();
    if (plan.promote) {
      // H3: existing promote helper (ready semantics preserved).
      ok = await applyPromoteToRunning(admin, vm.id, plan.private_ip ?? null, plan.public_ip ?? null);
      // AWS running with no public IP (or a changed one) — sync exact Describe value.
      if (ok && provider === "aws" && plan.public_ip === null && before.public_ip !== null) {
        await admin.from("virtual_machines").update({ public_ip: null }).eq("id", vm.id);
      }
    } else {
      const patch: Record<string, unknown> = {};
      if (after.status !== before.status) patch.status = after.status;
      if (after.public_ip !== before.public_ip) patch.public_ip = after.public_ip;
      if (after.private_ip !== before.private_ip) patch.private_ip = after.private_ip;
      if (plan.finaliseHubStop) {
        patch.ended_by = plan.finaliseHubStop.by;
        patch.ended_reason = plan.finaliseHubStop.reason;
        patch.ended_at = nowIso;
        const ni = { ...(vm.network_info ?? {}) };
        delete ni.stop_pending;
        patch.network_info = ni;
      } else if (plan.endedReason && patch.status) {
        patch.ended_by = "vm-reconcile";
        patch.ended_reason = vm.ended_reason || plan.endedReason; // keep an existing reason
        patch.ended_at = nowIso;
      }
      const { error } = await admin.from("virtual_machines").update(patch).eq("id", vm.id);
      if (error) {
        ok = false;
        console.error(`[vm-reconcile] write ${vm.id} failed:`, error.message);
      }
    }
    if (!ok) {
      results.push({ ...base, after: before, changed: false, code: "VM_RECONCILE_WRITE_FAILED", would_be: after });
      continue;
    }

    const detail = { cloud_state: plan.cloud_state, before, after, source: opts.source, provider };
    try {
      await admin.from("provisioning_events").insert({
        correlation_id: `recon_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
        vm_id: vm.id, user_id: vm.user_id ?? null, lab_template_id: vm.lab_template_id ?? null,
        source: opts.source, step: "vm-reconcile", status: "success",
        message: `${before.status}→${after.status}`, detail,
      });
    } catch (e) {
      console.error("[vm-reconcile] event insert failed:", e instanceof Error ? e.message : e);
    }

    if (plan.finaliseHubStop) {
      await recordAudit(admin, {
        actorId: null, actorType: "system", action: "vm.stop", entityType: "virtual_machine",
        entityId: vm.id, entityLabel: vm.azure_vm_id, outcome: "success",
        changes: { source: opts.source, vm_id: vm.id, provider_id: vm.azure_vm_id, result: "stopped", reason: plan.finaliseHubStop.reason, cloud_state: plan.cloud_state, finalised_from: "stop_pending" },
        message: plan.finaliseHubStop.reason,
      });
    } else if (plan.externalKind && HUB_LIVE.has(before.status) && (after.status === "stopped" || after.status === "failed" || after.status === "deallocated")) {
      // Once per transition: the next poll sees Hub already stopped/failed → no drift → no audit.
      await recordAudit(admin, {
        actorId: null, actorType: "system", action: plan.externalKind, entityType: "virtual_machine",
        entityId: vm.id, entityLabel: vm.azure_vm_id, outcome: "success",
        changes: { source: "external", vm_id: vm.id, provider_id: vm.azure_vm_id, result: after.status, cloud_state: plan.cloud_state },
        message: `${before.status}→${after.status} (${plan.cloud_state})`,
      });
      await notifyLearnerAndAdmins(admin, {
        userId: vm.user_id,
        type: "lab_external_stop",
        title: "Lab machine was stopped outside SkillHub",
        message: `Lab machine ${vm.azure_vm_id} is now ${after.status} (cloud: ${plan.cloud_state}). It was not stopped by SkillHub.`,
      });
    }
    results.push({ ...base, after, changed: true, ...(plan.code ? { code: plan.code } : {}) });
  }
  return results;
}
