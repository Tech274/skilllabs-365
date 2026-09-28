import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { CANCEL_PENDING_STOP_REASON, decideLearnerCancel } from "../_shared/lab-cancel-policy.ts";
import { corsHeadersFor, corsHeaders, requireAdmin, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse, type AuthCtx } from "../_shared/auth.ts";
import { correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, idempotencyKeyFrom, releaseIdempotency } from "../_shared/idempotency.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import {
  reconcileProvisioningAgainstAzure,
  applyPromoteToRunning,
  fetchInstanceViewStatuses,
} from "../_shared/azure-reconcile.ts";
import { azureStatusToVmStatus } from "../_shared/vm-state.ts";
import {
  resolveAwsRuntime, stopAwsInstance, terminateAwsInstance, describeAwsInstance,
} from "../_shared/cloud-providers/aws-runtime.ts";
import { startCloudVm, RESUMABLE_VM_STATUSES } from "../_shared/cloud-providers/vm-resume.ts";
import { buildWalletSnapshot, walletBlockMessage, type WalletSessionRow } from "../_shared/lab-wallet.ts";
import {
  decideSoftExpiry,
  expiresAtSkippedReason,
  guardedDeleteBlock,
  guardedLearnerLeaveBody,
  isHeldVm,
  isVmGuarded,
  parseHeldVmConfig,
  resolveSoftExpiryMode,
  softExpiryEnforced,
  softExpiryNotice,
  ORPHAN_SWEEP_STATUSES,
  SOFT_EXPIRY_STATUSES,
  type SoftExpiryTemplate,
} from "../_shared/lab-expiry.ts";
import {
  effectiveStopRetry,
  formatStopRetry,
  isLearnerResumablePendingStop,
  isStopRetryDue,
  nextStopRetryAfterFailure,
  type StopRetryState,
} from "../_shared/stop-retry.ts";
import {
  auditSweep,
  isFinalStopState,
  markStopPending,
  newStopPollBudget,
  stopAuditResult,
  stopVmHonest,
  type SweepVm,
} from "../_shared/vm-stop.ts";

const TERMINATE_DISABLED = { code: "TERMINATE_DISABLED", error: "VM delete is disabled (stop-only). Use Stop." };

/**
 * Azure credentials always come from the Resource Providers registry — one VM
 * may belong to a different subscription than the next, so contexts are
 * resolved (and cached) per provider account for the lifetime of a request.
 */
interface AzureCtx { token: string; subscriptionId: string; resourceGroup: string }

function makeAzureResolver(
  // deno-lint-ignore no-explicit-any -- service client, untyped in the edge runtime
  supabase: any,
) {
  const cache = new Map<string, Promise<AzureCtx>>();
  return (accountId?: string | null): Promise<AzureCtx> => {
    const key = accountId ?? "__default__";
    let entry = cache.get(key);
    if (!entry) {
      entry = (async () => {
        const rt = await resolveAzureRuntime(supabase, accountId ?? null);
        const token = await getAzureToken(rt.tenantId, rt.clientId, rt.clientSecret);
        return { token, subscriptionId: rt.subscriptionId, resourceGroup: rt.resourceGroup };
      })();
      cache.set(key, entry);
    }
    return entry;
  };
}

const SOURCE = "cleanup-idle-labs";

const IDLE_TIMEOUT_MINUTES = 15;
const STUCK_PROVISIONING_MINUTES = 10;

/** Get Azure access token */
async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://management.azure.com/.default",
      }),
    }
  );
  if (!res.ok) throw new Error(`Azure auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Deallocate an Azure VM */
async function deallocateAzureVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<boolean> {
  const apiVersion = "2024-03-01";
  const res = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/deallocate?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    console.error(`Failed to deallocate VM ${vmName}: ${await res.text()}`);
    return false;
  }
  return true;
}

/** Delete Azure VM and its resources */
async function deleteAzureVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<boolean> {
  const apiVersion = "2024-03-01";
  // Delete VM. NIC and OS disk use deleteOption=Delete. The lab public IP is
  // deleteOption=Delete on the NIC ipConfiguration, so it follows the NIC.
  const res = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=${apiVersion}&forceDeletion=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok && res.status !== 204 && res.status !== 202) {
    console.error(`Failed to delete VM ${vmName}: ${await res.text()}`);
    return false;
  }
  return true;
}

/** Extract VM name from azure_vm_id (could be full resource path or just name) */
function extractVmName(azureVmId: string): string {
  if (azureVmId.includes("/")) {
    const parts = azureVmId.split("/");
    return parts[parts.length - 1];
  }
  return azureVmId;
}

async function providerOf(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  accountId?: string | null,
): Promise<"azure" | "aws" | string> {
  if (!accountId) return "azure";
  const { data } = await supabase
    .from("cloud_provider_accounts")
    .select("provider")
    .eq("id", accountId)
    .maybeSingle();
  return (data?.provider as string) || "azure";
}

/** Stop (deallocate / StopInstances) a lab VM on its home cloud. */
async function stopCloudVm(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  azureFor: (accountId?: string | null) => Promise<AzureCtx>,
  vm: { azure_vm_id: string; provider_account_id?: string | null; region?: string | null },
): Promise<boolean> {
  noteCloud("stopCloudVm");
  const provider = await providerOf(supabase, vm.provider_account_id);
  if (provider === "aws") {
    const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
    if (vm.region) aws.defaultRegion = String(vm.region);
    await stopAwsInstance(aws, vm.azure_vm_id);
    return true;
  }
  const az = await azureFor(vm.provider_account_id);
  return await deallocateAzureVM(az.token, az.subscriptionId, az.resourceGroup, extractVmName(vm.azure_vm_id));
}

/**
 * After a failed StopInstances/deallocate, describe the cloud VM.
 * If it is already soft-stopped (AWS stopped / Azure deallocated only),
 * callers may mark Hub deallocated with cloud_stop_ok via reconcile.
 * Azure stopped is still allocated and does not count.
 */
async function isCloudAlreadySoftStopped(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  azureFor: (accountId?: string | null) => Promise<AzureCtx>,
  vm: { azure_vm_id: string; provider_account_id?: string | null; region?: string | null },
): Promise<{ softStopped: boolean; detail: string }> {
  const provider = await providerOf(supabase, vm.provider_account_id);
  if (provider === "aws") {
    const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
    if (vm.region) aws.defaultRegion = String(vm.region);
    const desc = await describeAwsInstance(aws, vm.azure_vm_id);
    const softStopped = isFinalStopState("aws", desc.state);
    return { softStopped, detail: `aws state=${desc.state}` };
  }
  const az = await azureFor(vm.provider_account_id);
  const statuses = await fetchInstanceViewStatuses(az, extractVmName(vm.azure_vm_id));
  if (!statuses) return { softStopped: false, detail: "azure instanceView unavailable" };
  const mapped = azureStatusToVmStatus(statuses);
  const softStopped = isFinalStopState("azure", mapped);
  return { softStopped, detail: `azure mapped=${mapped ?? "null"}` };
}

/** Delete / terminate a lab VM on its home cloud. */
async function deleteCloudVm(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  azureFor: (accountId?: string | null) => Promise<AzureCtx>,
  vm: { azure_vm_id: string; provider_account_id?: string | null; region?: string | null },
): Promise<boolean> {
  noteCloud("deleteCloudVm");
  const provider = await providerOf(supabase, vm.provider_account_id);
  if (provider === "aws") {
    const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
    if (vm.region) aws.defaultRegion = String(vm.region);
    await terminateAwsInstance(aws, vm.azure_vm_id);
    return true;
  }
  const az = await azureFor(vm.provider_account_id);
  return await deleteAzureVM(az.token, az.subscriptionId, az.resourceGroup, extractVmName(vm.azure_vm_id));
}


/** Persist end metadata on virtual_machines (deallocate / terminate / fail paths). */
async function markVmEnded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  vmId: string,
  patch: { status: string; ended_by: string; ended_reason: string; ended_at?: string },
) {
  const ended_at = patch.ended_at ?? new Date().toISOString();
  await supabase.from("virtual_machines").update({
    status: patch.status,
    ended_by: patch.ended_by,
    ended_reason: patch.ended_reason,
    ended_at,
  }).eq("id", vmId);
}

/**
 * Learner soft-stop (Leave, and SCRUM-106 cancel of an existing allocation):
 * deallocate the SAME VM, never delete.
 * Honesty gate: Hub deallocated ONLY when cloud soft-stop (or reconcile) succeeded.
 */
async function softStopLearnerVm(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  azureFor: ReturnType<typeof makeAzureResolver>,
  // deno-lint-ignore no-explicit-any
  vm: any,
  opts: { actorId: string; endedReason: string; nowIso: string; logEvent: string },
): Promise<{ stopped: boolean; stopDetail: string | null; reconciled: boolean; hubStatus: string; priorStatus: string; live: boolean }> {
  noteCloud("softStopLearnerVm");
  const targetVmId = vm.id as string;
  const priorStatus = String(vm.status || "running");
  const live = ["running", "provisioning", "starting", "idle"].includes(priorStatus.toLowerCase());
  let stopped = !live;
  let stopDetail: string | null = null;
  let reconciled = false;
  if (live && vm.azure_vm_id) {
    try {
      stopped = await stopCloudVm(supabase, azureFor, vm);
      if (!stopped) stopDetail = "cloud soft-stop returned false";
    } catch (e) {
      stopDetail = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({
        event: `${opts.logEvent}_stop_failed`,
        vm_id: targetVmId,
        instance_id: vm.azure_vm_id,
        region: vm.region ?? null,
        detail: stopDetail,
      }));
      stopped = false;
    }
    // Optional reconcile: Stop may have failed while cloud is already soft-stopped.
    if (!stopped) {
      try {
        const recon = await isCloudAlreadySoftStopped(supabase, azureFor, vm);
        if (recon.softStopped) {
          stopped = true;
          reconciled = true;
          stopDetail = stopDetail
            ? `${stopDetail}; reconciled: ${recon.detail}`
            : `reconciled: ${recon.detail}`;
        } else if (!stopDetail) {
          stopDetail = recon.detail;
        } else {
          stopDetail = `${stopDetail}; ${recon.detail}`;
        }
      } catch (e) {
        const reconDetail = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({
          event: `${opts.logEvent}_reconcile_failed`,
          vm_id: targetVmId,
          instance_id: vm.azure_vm_id,
          detail: reconDetail,
        }));
        stopDetail = stopDetail ? `${stopDetail}; reconcile failed: ${reconDetail}` : `reconcile failed: ${reconDetail}`;
      }
    }
  }

  // Session/wallet close still proceed for the learner UX; power state stays truthful.
  const hubStatus = live ? (stopped ? "deallocated" : priorStatus) : priorStatus;
  if (live && stopped) {
    await markVmEnded(supabase, targetVmId, {
      status: "deallocated",
      ended_by: opts.actorId,
      ended_reason: opts.endedReason,
      ended_at: opts.nowIso,
    });
  }
  return { stopped, stopDetail, reconciled, hubStatus, priorStatus, live };
}

type SoftExpiryCandidate = {
  id: string;
  azure_vm_id: string | null;
  status: string;
  expires_at: string | null;
  user_id: string | null;
  lab_template_id: string | null;
  provider_account_id: string | null;
  region: string | null;
};

const SOFT_EXPIRY_PAGE = 200;
const SOFT_EXPIRY_MAX = 2000;

/**
 * Every VM that may still bill compute, paged (the old sweep stopped at 200
 * rows). `region` is selected so AWS stops hit the VM's own region.
 */
async function loadSoftExpiryCandidates(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<SoftExpiryCandidate[]> {
  const out: SoftExpiryCandidate[] = [];
  for (let from = 0; from < SOFT_EXPIRY_MAX; from += SOFT_EXPIRY_PAGE) {
    const { data, error } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, status, expires_at, user_id, lab_template_id, provider_account_id, region")
      .in("status", [...SOFT_EXPIRY_STATUSES])
      .order("id", { ascending: true })
      .range(from, from + SOFT_EXPIRY_PAGE - 1);
    if (error) {
      console.error("soft-expiry candidate query failed:", error.message);
      break;
    }
    const rows = (data ?? []) as SoftExpiryCandidate[];
    out.push(...rows);
    if (rows.length < SOFT_EXPIRY_PAGE) return out;
  }
  console.warn(JSON.stringify({ event: "soft_expiry_candidates_capped", cap: SOFT_EXPIRY_MAX }));
  return out;
}

async function cachedTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cache: Map<string, SoftExpiryTemplate | null>,
  templateId: string,
): Promise<SoftExpiryTemplate | null> {
  if (cache.has(templateId)) return cache.get(templateId) ?? null;
  const { data, error } = await supabase
    .from("lab_templates")
    .select("id, name, duration, is_persistent, end_date")
    .eq("id", templateId)
    .maybeSingle();
  // A failed lookup (or a missing row) returns null = persistence UNKNOWN.
  // decideSoftExpiry treats unknown like persistent (expires_at alone never
  // stops it) — the cautious default, same as the SCRUM-106 Cancel policy.
  if (error) {
    console.error(JSON.stringify({ event: "soft_expiry_template_lookup_failed", template_id: templateId, detail: error.message }));
  }
  const tpl = (error ? null : (data ?? null)) as SoftExpiryTemplate | null;
  cache.set(templateId, tpl);
  return tpl;
}

/** Wallet usage = this learner's sessions on this template (same query as the Start gate). */
async function cachedUsage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cache: Map<string, WalletSessionRow[]>,
  userId: string,
  templateId: string,
): Promise<WalletSessionRow[]> {
  const key = `${userId}:${templateId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { data } = await supabase
    .from("sessions")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .eq("lab_template_id", templateId)
    .limit(500);
  const rows = (data ?? []) as WalletSessionRow[];
  cache.set(key, rows);
  return rows;
}

/** Notify learner (if any) + all admins via notifications table. */
async function notifyLearnerAndAdmins(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: { userId?: string | null; type: string; title: string; message: string },
) {
  const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds: string[] = (adminRoles ?? []).map((r: { user_id: string }) => r.user_id);
  const recipients = new Set<string>(adminIds);
  if (opts.userId) recipients.add(opts.userId);
  if (recipients.size === 0) return;
  const rows = [...recipients].map((uid) => ({
    user_id: uid,
    type: opts.type,
    title: opts.title,
    message: opts.message,
  }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) console.error("notifyLearnerAndAdmins failed:", error.message);
}

/**
 * expires_at patch for a Start: non-persistent → now + duration; persistent →
 * null (window/wallet governed; a stale expires_at must not let the next cron
 * tick undo this Start). Unknown template → leave expires_at untouched.
 */
async function remintExpiresPatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  templateId: string | null | undefined,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};
  if (!templateId) return patch;
  const { data: remintTpl } = await supabase
    .from("lab_templates")
    .select("duration, is_persistent")
    .eq("id", templateId)
    .maybeSingle();
  if (remintTpl && !remintTpl.is_persistent && Number(remintTpl.duration) > 0) {
    patch.expires_at = new Date(Date.now() + Number(remintTpl.duration) * 60 * 1000).toISOString();
  } else if (remintTpl?.is_persistent) {
    patch.expires_at = null;
  }
  return patch;
}

/** Per-run counters for idle / orphan / Cancel-retry cloud stop failures. */
type StopRetrySummary = {
  failed: number;
  escalated_needs_admin: number;
  backoff_skipped: number;
  needs_admin_skipped: number;
  resumed_by_learner_skipped: number;
};

/**
 * Record a failed automatic cloud stop ON THE VM ROW (visible to admins on
 * /vms), with a retry counter + backoff (see _shared/stop-retry.ts). After
 * STOP_RETRY_MAX_ATTEMPTS the row is flagged `stop_failed_needs_admin:<n>`,
 * retries stop and admins get ONE notification — never only a log line.
 */
async function recordStopFailure(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  vm: { id: string; azure_vm_id?: string | null },
  current: StopRetryState | null,
  opts: { pass: "idle" | "orphan" | "cancel_retry"; detail: string | null; nowIso: string; summary: StopRetrySummary },
) {
  const next = nextStopRetryAfterFailure(current, opts.pass === "cancel_retry" ? "cancel" : "cleanup");
  const marker = formatStopRetry(next.state);
  const patch: Record<string, unknown> = { ended_reason: marker, ended_at: opts.nowIso };
  // Keep the learner as ended_by on a Cancel marker; idle/orphan are the cron's.
  if (opts.pass !== "cancel_retry") patch.ended_by = SOURCE;
  const { error } = await supabase.from("virtual_machines").update(patch).eq("id", vm.id);
  if (error) console.error("recordStopFailure: marker update failed", error.message);
  opts.summary.failed += 1;
  console.error(JSON.stringify({
    event: "cleanup_stop_failed",
    pass: opts.pass,
    vm_id: vm.id,
    attempts: next.state.attempts,
    marker,
    escalated: next.escalated,
    detail: opts.detail,
  }));
  if (next.escalated) {
    opts.summary.escalated_needs_admin += 1;
    const label = vm.azure_vm_id ? extractVmName(vm.azure_vm_id) : vm.id.slice(0, 8);
    await notifyLearnerAndAdmins(supabase, {
      userId: null, // admins only
      type: "vm_stop_failed",
      title: "Lab VM needs attention — automatic stop failed",
      message:
        `Cleanup could not stop VM ${label} (${vm.id}) after ${next.state.attempts} attempts (${opts.pass}). ` +
        `Automatic retries have stopped. Last error: ${(opts.detail ?? "unknown").slice(0, 200)}. ` +
        `Check the instance in the cloud console, then Stop or Delete it from /vms.`,
    });
  }
}

/** Control-flow marker: SOFT_EXPIRY_MODE=off skips the soft-expiry sweep. */
class SkipSweep extends Error {}

let cleanupCloudListener: ((name: string) => void) | null = null;
function noteCloud(name: string) {
  cleanupCloudListener?.(name);
}

export type CleanupHandlerDeps = {
  // deno-lint-ignore no-explicit-any -- test double or service client
  supabase?: any;
  auth?: AuthCtx;
  /** Invoked immediately before a cloud call. Tests assert this stays empty. */
  onCloud?: (name: string) => void;
  /** Test seam. Production uses startCloudVm. */
  startCloudVm?: typeof startCloudVm;
};

export async function handleCleanupRequest(req: Request, deps?: CleanupHandlerDeps): Promise<Response> {
  const prev = cleanupCloudListener;
  cleanupCloudListener = deps?.onCloud ?? null;
  try {
    return await handleCleanupRequestInner(req, deps);
  } finally {
    cleanupCloudListener = prev;
  }
}

async function handleCleanupRequestInner(req: Request, deps?: CleanupHandlerDeps): Promise<Response> {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse optional body for manual trigger (before auth so we can branch on action)
    let action = "auto-cleanup";
    let targetVmId: string | null = null;
    let actionReason: string | null = null;
    let rawBody: Record<string, unknown> = {};
    try {
      rawBody = await req.json();
      action = (rawBody.action as string) || action;
      targetVmId = (rawBody.vm_id as string) || null;
      actionReason = typeof rawBody.reason === "string" && rawBody.reason.trim()
        ? (rawBody.reason as string).trim()
        : null;
    } catch { /* no body = scheduled run */ }
    const correlationId = correlationIdFrom(req);

    // Student-callable actions (scoped to the caller's own VM):
    //   cancel-provisioning — hard cancel while provisioning
    //   learner-leave       — Leave / soft-stop: end session (wallet deduct) + deallocate, never delete
    //   start-vm            — Start-from-deallocated: resume SAME allocation (owner + wallet gate)
    // Everything else stays admin / service-role only.
    const auth = deps?.auth
      ?? ((action === "cancel-provisioning" || action === "learner-leave" || action === "start-vm")
        ? await requireUser(req)
        : await requireAdmin(req));
    if (auth instanceof Response) return auth;

    const supabase = deps?.supabase ?? createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const azureFor = makeAzureResolver(supabase);
    const stopBudget = newStopPollBudget();
    // Held VMs (smoke VM, Guac hosts, Ops holds) are never touched by automatic
    // passes or purge. Stop, cancel, delete, and start on a guarded VM return
    // 423 before any session or VM-row write and before any cloud call.
    // Learner leave on a guarded VM returns 200 kept_running, closes only the
    // learner session, and does not write the VM row or call the cloud.
    // There is no admin bypass on delete; remove the VM from the list first.
    const heldConfig = parseHeldVmConfig(Deno.env.get("CLEANUP_HELD_VM_IDS"));
    const heldVms = heldConfig.entries;
    for (const w of heldConfig.warnings) console.warn(JSON.stringify({ event: "held_vm_entry_warning", detail: w }));
    // SOFT_EXPIRY_MODE gates ONLY the soft-expiry sweep. The idle, orphan
    // (incl. Cancel pending-stop retries) and stuck-provisioning passes run in
    // every mode, including `off` — product decision, keep it that way.
    // Unknown values fail safe to dry-run (warned + reported in the response).
    const softExpiryModeConfig = resolveSoftExpiryMode(Deno.env.get("SOFT_EXPIRY_MODE"));
    const softExpiryMode = softExpiryModeConfig.mode;
    if (softExpiryModeConfig.warning) {
      console.warn(JSON.stringify({ event: "soft_expiry_mode_invalid", detail: softExpiryModeConfig.warning }));
    }

    // Student-owned cancellation of a provisioning / running VM
    if (action === "cancel-provisioning") {
      if (!targetVmId) return errorResponse("vm_id required", 400);

      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status, user_id, lab_template_id, provider_account_id, region, private_ip, expires_at")
        .eq("id", targetVmId)
        .maybeSingle();
      if (!vm) return errorResponse("VM not found", 404);

      const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
      if (forbidden) return forbidden;

      if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) {
        return jsonResponse({ error: "VM_PROTECTED", code: "VM_PROTECTED", vm_id: vm.id }, 423);
      }

      const timeline = new ProvisioningTimeline(supabase, {
        correlationId,
        userId: vm.user_id,
        vmId: vm.id,
        labTemplateId: vm.lab_template_id,
      });

      // Terminal already -> nothing to do. Cancelling twice must be a no-op,
      // never a second Azure delete call.
      if (vm.status === "terminated" || vm.status === "failed") {
        await timeline.skipped(SOURCE, "cancel", "VM was already stopped — cancellation ignored", { status: vm.status });
        return jsonResponse({ success: true, action: "already-cancelled", vm_id: targetVmId, correlation_id: correlationId });
      }

      // SCRUM-106: a learner Cancel must never delete an allocation that already
      // holds work (Start/resume of an existing VM, or a previously used VM).
      // Those are soft-stopped exactly like Leave. Admin cancel keeps hard-delete.
      // Review follow-up: an admin clicking the learner panel's Cancel is NOT an
      // implicit hard delete; that needs the service role (operator retry) or an
      // explicit `force_delete: true` from an admin.
      let cancelIsAdmin = false;
      if (!auth.isServiceRole) {
        const { data: adminFlag } = await supabase.rpc("is_platform_admin", { _user_id: auth.userId });
        cancelIsAdmin = adminFlag === true;
      }
      const forceDelete = rawBody.force_delete === true;
      let priorSessions = 0;
      let isPersistent: boolean | null = null;
      if (!auth.isServiceRole && !(cancelIsAdmin && forceDelete)) {
        // ANY session (active or ended) is learner use — a first, still-active
        // session must never be hard-deleted on Cancel.
        const { count, error: countErr } = await supabase
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("vm_id", targetVmId);
        // Fail safe: if usage cannot be read, treat the VM as used (soft-stop).
        priorSessions = countErr ? 1 : (count ?? 0);
        if (vm.lab_template_id) {
          const { data: cancelTpl } = await supabase
            .from("lab_templates")
            .select("is_persistent")
            .eq("id", vm.lab_template_id)
            .maybeSingle();
          if (cancelTpl) isPersistent = Boolean(cancelTpl.is_persistent);
        }
      }
      const cancelDecision = decideLearnerCancel({
        isServiceRole: auth.isServiceRole,
        isAdmin: cancelIsAdmin,
        forceDelete,
        status: vm.status,
        priorSessions,
        isPersistent,
      });
      if (cancelDecision.mode === "soft_stop") {
        const nowIso = new Date().toISOString();
        await supabase
          .from("sessions")
          .update({ ended_at: nowIso, status: "completed", disconnect_reason: "learner_cancel" })
          .eq("vm_id", targetVmId)
          .eq("status", "active");
        const soft = await softStopLearnerVm(supabase, azureFor, vm, {
          actorId: auth.userId,
          endedReason: "learner_cancel_kept",
          nowIso,
          logEvent: "learner_cancel",
        });
        if (soft.live && !soft.stopped) {
          // Cloud refused the stop (e.g. AWS StopInstances on a `pending` instance
          // while resuming). Leave the power state truthful but mark the row so the
          // cron orphan pass retries the soft-stop instead of leaving it billing.
          // Retry count / backoff / admin escalation: _shared/stop-retry.ts.
          await supabase.from("virtual_machines").update({
            ended_by: auth.userId,
            ended_reason: CANCEL_PENDING_STOP_REASON,
            ended_at: nowIso,
          }).eq("id", targetVmId);
        }
        await timeline.skipped(
          SOURCE,
          "cancel",
          "Cancel on an existing lab machine — soft-stopped (deallocated), NOT deleted",
          { reason: cancelDecision.reason, cloud_stop_ok: soft.stopped, hub_status: soft.hubStatus },
        );
        console.log(JSON.stringify({
          event: "learner_cancel_soft_stop",
          vm_id: targetVmId,
          actor: auth.userId,
          decision: cancelDecision.reason,
          prior_status: soft.priorStatus,
          hub_status: soft.hubStatus,
          cloud_stop_ok: soft.stopped,
          reconciled: soft.reconciled,
          stop_detail: soft.stopDetail,
        }));
        return jsonResponse({
          success: true,
          action: "cancel-soft-stopped",
          vm_id: targetVmId,
          status: soft.hubStatus,
          soft_stop: true,
          deleted: false,
          decision: cancelDecision.reason,
          cloud_stop_ok: soft.stopped,
          stop_detail: soft.stopDetail,
          correlation_id: correlationId,
        });
      }

      // Idempotency key guards concurrent duplicate cancels.
      const cancelKey = idempotencyKeyFrom(req, { ...rawBody, idempotency_key: rawBody.idempotency_key ?? `cancel:${targetVmId}` });
      const claim = await claimIdempotency(supabase, {
        key: cancelKey,
        userId: auth.userId,
        action: "cancel-provisioning",
        correlationId,
      });
      if (claim.outcome === "replay") {
        await timeline.skipped(SOURCE, "cancel", "Duplicate cancellation replayed", { key: cancelKey });
        return jsonResponse({ ...claim.response, idempotent_replay: true });
      }
      if (claim.outcome === "in_progress") {
        await timeline.skipped(SOURCE, "cancel", "Duplicate cancellation ignored — one is already running", { key: cancelKey });
        return jsonResponse({ success: true, action: "cancel-in-progress", vm_id: targetVmId, idempotent_replay: true });
      }

      try {
        await timeline.start(SOURCE, "cancel", "Cancelling lab and releasing Azure resources");

        await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString(), status: "completed" })
          .eq("vm_id", targetVmId)
          .eq("status", "active");

        if (vm.azure_vm_id) {
          try {
            await deleteCloudVm(supabase, azureFor, vm);
          } catch (e) {
            console.error("cancel-provisioning: cloud delete failed", e);
            await timeline.failed(SOURCE, "cloud-delete", e instanceof Error ? e.message : "Cloud delete failed");
          }
        }

        await markVmEnded(supabase, targetVmId, {
          status: "terminated",
          ended_by: auth.userId,
          ended_reason: actionReason || "cancel_provisioning",
        });
        const response = { success: true, action: "cancelled", vm_id: targetVmId, deleted: true, correlation_id: correlationId };
        await completeIdempotency(supabase, {
          key: cancelKey,
          userId: auth.userId,
          action: "cancel-provisioning",
          response,
        });
        await timeline.success(SOURCE, "cancel", "Lab cancelled and Azure resources released");
        return jsonResponse(response);
      } catch (e) {
        await releaseIdempotency(supabase, { key: cancelKey, userId: auth.userId, action: "cancel-provisioning" });
        throw e;
      }
    }

    // Learner Leave / soft-stop: end active sessions (billable minutes deduct) +
    // deallocate the SAME allocation. Never delete. Start later remints this VM.
    if (action === "learner-leave") {
      if (!targetVmId) return errorResponse("vm_id required", 400);

      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status, user_id, lab_template_id, provider_account_id, region, private_ip, expires_at")
        .eq("id", targetVmId)
        .maybeSingle();
      if (!vm) return errorResponse("VM not found", 404);

      const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
      if (forbidden) return forbidden;

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const leaveGuarded = isHeldVm(vm, heldVms) || isVmGuarded(vm);
      let stopped = false;
      let stopDetail: string | null = leaveGuarded ? "protected VM — stop blocked" : null;
      let reconciled = false;
      let hubStatus = String(vm.status || "running");
      const priorStatus = hubStatus;

      // Guarded leave: close only the learner session (same fields as a normal
      // Leave, so the wallet stops). No audit write, no VM-row write, no cloud call.
      if (leaveGuarded) {
        await supabase
          .from("sessions")
          .update({
            ended_at: nowIso,
            status: "completed",
            disconnect_reason: "learner_leave",
          })
          .eq("vm_id", targetVmId)
          .eq("status", "active");
        console.log(JSON.stringify({
          event: "learner_leave",
          vm_id: targetVmId,
          actor: auth.userId,
          stopped: false,
          kept_running: true,
          reason: "VM_PROTECTED",
          session_closed: true,
          hub_status: hubStatus,
          prior_status: priorStatus,
        }));
        return jsonResponse({
          ...guardedLearnerLeaveBody(),
          action: "learner-leave",
          vm_id: targetVmId,
          status: hubStatus,
          deleted: false,
          correlation_id: correlationId,
        }, 200);
      }

      // Close Guac/session rows first so wallet usage includes this Leave interval.
      await supabase
        .from("sessions")
        .update({
          ended_at: nowIso,
          status: "completed",
          disconnect_reason: "learner_leave",
        })
        .eq("vm_id", targetVmId)
        .eq("status", "active");

      {
        const soft = await softStopLearnerVm(
          supabase, azureFor, vm, { actorId: auth.userId, endedReason: "learner_leave", nowIso, logEvent: "learner_leave" },
        );
        stopped = soft.stopped;
        stopDetail = soft.stopDetail;
        reconciled = soft.reconciled;
        hubStatus = soft.hubStatus;
      }

      let wallet = {
        allocated_minutes: 0,
        used_minutes: 0,
        remaining_minutes: 0,
        exhausted: false,
        window_ended: false,
      };
      if (vm.lab_template_id && vm.user_id) {
        const { data: tpl } = await supabase
          .from("lab_templates")
          .select("id, duration, is_persistent, end_date")
          .eq("id", vm.lab_template_id)
          .maybeSingle();
        const { data: usage } = await supabase
          .from("sessions")
          .select("started_at, ended_at")
          .eq("user_id", vm.user_id)
          .eq("lab_template_id", vm.lab_template_id)
          .limit(500);
        if (tpl) {
          const snap = buildWalletSnapshot({
            duration: tpl.duration,
            endDate: tpl.end_date,
            isPersistent: tpl.is_persistent,
            sessions: usage ?? [],
            nowMs,
          });
          wallet = {
            allocated_minutes: snap.allocatedMinutes,
            used_minutes: snap.usedMinutes,
            remaining_minutes: snap.remainingMinutes,
            exhausted: snap.exhausted,
            window_ended: snap.windowEnded,
          };
        }
      }

      console.log(JSON.stringify({
        event: "learner_leave",
        vm_id: targetVmId,
        actor: auth.userId,
        stopped,
        cloud_stop_ok: stopped,
        reconciled,
        stop_detail: stopDetail,
        hub_status: hubStatus,
        prior_status: priorStatus,
        region: vm.region ?? null,
        instance_id: vm.azure_vm_id ?? null,
        wallet,
      }));

      return jsonResponse({
        success: true,
        action: "learner-leave",
        vm_id: targetVmId,
        status: hubStatus,
        soft_stop: true,
        deleted: false,
        cloud_stop_ok: stopped,
        stop_detail: stopDetail,
        wallet,
        correlation_id: correlationId,
      }, 200);
    }

    // Handle targeted stop/delete actions
    if ((action === "stop-vm" || action === "delete-vm" || action === "start-vm") && targetVmId) {
      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status, provider_account_id, region, private_ip, expires_at, user_id, lab_template_id, ended_reason")
        .eq("id", targetVmId)
        .maybeSingle();

      if (!vm) {
        return new Response(JSON.stringify({ error: "VM not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Start-from-deallocated: power the SAME allocation back on (never provision a new VM).
      // Learner (owner) may resume when wallet allows; admin may start any VM.
      if (action === "start-vm") {
        const forbidden = await requireOwnerOrAdmin(auth, (vm as { user_id?: string | null }).user_id);
        if (forbidden) return forbidden;

        // Guarded VMs are not started and are not ghost-reconciled. No cloud
        // call and no virtual_machines write (including ghost_instance_not_found).
        if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) {
          return new Response(JSON.stringify({
            error: "Protected VM — start blocked",
            code: "VM_PROTECTED",
            vm_id: targetVmId,
          }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const status = String(vm.status || "").toLowerCase();
        // Riley #58: Start from the learner's "Pausing…" card (a Cancel whose cloud
        // stop is still pending on a live VM) must take the Cancel back — clear the
        // retry marker so the next cron tick cannot stop a VM the learner restarted.
        const resumePendingStop = isLearnerResumablePendingStop(status, (vm as { ended_reason?: string | null }).ended_reason);
        if (!resumePendingStop && !(RESUMABLE_VM_STATUSES as readonly string[]).includes(status)) {
          return new Response(JSON.stringify({
            error: `VM status "${vm.status}" is not startable (need stopped/deallocated)`,
            vm_id: targetVmId,
            status: vm.status,
          }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!vm.azure_vm_id) {
          return new Response(JSON.stringify({ error: "VM has no cloud instance id", vm_id: targetVmId }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Admin / service-role override skips the wallet gate. Learners must pass
        // the same LAB_MINUTES_EXHAUSTED / LAB_WINDOW_ENDED checks as provision-lab.
        // Eligibility: own deallocated/stopped VM when template is_persistent OR
        // wallet remaining + window open (walletBlockMessage covers both).
        let isPlatformAdmin = auth.isServiceRole;
        if (!isPlatformAdmin) {
          const { data: adminFlag } = await supabase.rpc("is_platform_admin", { _user_id: auth.userId });
          isPlatformAdmin = adminFlag === true;
        }
        if (!isPlatformAdmin) {
          const labTemplateId = (vm as { lab_template_id?: string | null }).lab_template_id;
          const ownerUserId = (vm as { user_id?: string | null }).user_id;
          if (!labTemplateId || !ownerUserId) {
            return new Response(JSON.stringify({
              error: "VM is missing lab template or owner — cannot evaluate Start wallet gate",
              vm_id: targetVmId,
              code: "START_WALLET_CONTEXT_MISSING",
            }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const { data: tpl } = await supabase
            .from("lab_templates")
            .select("id, duration, is_persistent, end_date")
            .eq("id", labTemplateId)
            .maybeSingle();
          if (!tpl) {
            return new Response(JSON.stringify({
              error: "Lab template not found for this VM",
              vm_id: targetVmId,
            }), {
              status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const { data: usage } = await supabase
            .from("sessions")
            .select("started_at, ended_at")
            .eq("user_id", ownerUserId)
            .eq("lab_template_id", labTemplateId)
            .limit(500);
          const snap = buildWalletSnapshot({
            duration: tpl.duration,
            endDate: tpl.end_date,
            isPersistent: tpl.is_persistent,
            sessions: usage ?? [],
          });
          const blocked = walletBlockMessage(snap);
          // Same gate as provision-lab: LAB_WINDOW_ENDED / LAB_MINUTES_EXHAUSTED.
          // Soft-stop never purged the VM — Start is simply refused until Ops extends.
          if (blocked) {
            return new Response(JSON.stringify({
              error: blocked.error,
              code: blocked.code,
              vm_id: targetVmId,
              wallet: {
                allocated_minutes: snap.allocatedMinutes,
                used_minutes: snap.usedMinutes,
                remaining_minutes: snap.remainingMinutes,
                exhausted: snap.exhausted,
                window_ended: snap.windowEnded,
              },
            }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // Eligibility for learners: is_persistent OR wallet remaining (window open).
          // walletBlockMessage already enforced window/exhausted; remaining>0 (or
          // unmetered duration=0) covers the non-persistent same-VM resume case.
          const remainingOk = snap.remainingMinutes > 0 || snap.allocatedMinutes === 0;
          if (!Boolean(tpl.is_persistent) && !remainingOk) {
            return new Response(JSON.stringify({
              error:
                `Lab minutes used up (${snap.allocatedMinutes} allocated, ${snap.usedMinutes} used, 0 remaining). Start is blocked until more minutes are granted. Your lab machine is held (not deleted).`,
              code: "LAB_MINUTES_EXHAUSTED",
              vm_id: targetVmId,
            }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        if (resumePendingStop) {
          // The VM never stopped (it is still powering on / running): no cloud
          // call. Clear the marker only if it is still the one we read, so a
          // concurrent cron stop wins cleanly (learner then just presses Start).
          const staleReason = (vm as { ended_reason?: string | null }).ended_reason ?? "";
          const resumeExpires = await remintExpiresPatch(supabase, (vm as { lab_template_id?: string | null }).lab_template_id);
          const { data: cleared } = await supabase
            .from("virtual_machines")
            .update({ ended_by: null, ended_reason: null, ended_at: null, ...resumeExpires })
            .eq("id", targetVmId)
            .eq("status", vm.status)
            .eq("ended_reason", staleReason)
            .select("id");
          if (!cleared || cleared.length === 0) {
            return new Response(JSON.stringify({
              error: "Your lab machine was just paused. Press Start again to resume it.",
              code: "VM_STATE_CHANGED",
              vm_id: targetVmId,
            }), {
              status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const resumeReason = actionReason || (isPlatformAdmin ? "admin_start" : "learner_start");
          console.log(JSON.stringify({
            event: "vm_start_pending_stop_cancelled",
            vm_id: targetVmId,
            actor: auth.userId,
            prior_status: vm.status,
            cleared_marker: staleReason,
            reason: resumeReason,
          }));
          return new Response(JSON.stringify({
            success: true,
            action: "resumed-pending-stop",
            vm_id: targetVmId,
            status: vm.status,
            reminted: true,
            reason: resumeReason,
          }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const provider = await providerOf(supabase, vm.provider_account_id);
        noteCloud("startCloudVm");
        const startFn = deps?.startCloudVm ?? startCloudVm;
        const started = await startFn(supabase, provider, {
          id: vm.id,
          status: vm.status,
          azure_vm_id: vm.azure_vm_id,
          private_ip: vm.private_ip ?? null,
          provider_account_id: vm.provider_account_id ?? null,
          expires_at: vm.expires_at ?? null,
          region: vm.region ?? null,
        });
        if (!started.ok) {
          // 90s default clock (no shared remint clock on this path). A cap
          // before StartInstances is retryable and must not touch the row.
          if (started.code === "REMINT_START_FAILED") {
            return new Response(JSON.stringify({
              error: "Your lab machine was still stopping, so it was not started. Nothing was changed — please retry in a minute.",
              code: "REMINT_START_FAILED",
              retryable: true,
              vm_id: targetVmId,
              detail: started.detail ?? "remint wait cap hit before StartInstances",
              aws_state: started.awsState ?? null,
              provider,
              region: vm.region ?? null,
            }), {
              status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          console.error(JSON.stringify({
            event: "vm_start_rejected",
            vm_id: targetVmId,
            provider,
            region: vm.region ?? null,
            instance_id: vm.azure_vm_id,
            detail: started.detail ?? null,
            aws_state: started.awsState ?? null,
            ghost: started.ghost === true,
          }));
          // P0a: Ghost Hub reconcile — DescribeInstances NotFound → mark failed,
          // never leave Admin Start retrying StartInstances on a missing EC2.
          // Does NOT call TerminateInstances (Guacs / live fleet untouched).
          if (started.ghost || started.awsState === "not-found") {
            const endedAt = new Date().toISOString();
            await supabase.from("virtual_machines").update({
              status: "failed",
              ended_at: endedAt,
              ended_by: auth.userId,
              ended_reason: "ghost_instance_not_found",
            }).eq("id", targetVmId);
            console.log(JSON.stringify({
              event: "vm_ghost_reconciled",
              vm_id: targetVmId,
              instance_id: vm.azure_vm_id,
              actor: auth.userId,
              hub_status: "failed",
            }));
            return new Response(JSON.stringify({
              error: "Cloud instance no longer exists (ghost Hub row reconciled to failed)",
              code: "GHOST_INSTANCE",
              vm_id: targetVmId,
              detail: started.detail ?? "InvalidInstanceID.NotFound",
              aws_state: started.awsState ?? "not-found",
              provider,
              region: vm.region ?? null,
              reconciled_status: "failed",
            }), {
              status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            error: "Cloud start rejected",
            code: "CLOUD_START_REJECTED",
            vm_id: targetVmId,
            detail: started.detail ?? "unknown cloud start failure",
            aws_state: started.awsState ?? null,
            provider,
            region: vm.region ?? null,
          }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Refresh AWS public_ip after Start (ephemeral public IP changes on
        // Stop→Start). Describe may still be pending; check-vm-status promote
        // re-writes when Running.
        const ipPatch: Record<string, unknown> = {};
        if (provider === "aws" && vm.azure_vm_id) {
          try {
            const awsRt = await resolveAwsRuntime(supabase, vm.provider_account_id);
            if (vm.region) awsRt.defaultRegion = String(vm.region);
            noteCloud("describeAwsInstance");
            const desc = await describeAwsInstance(awsRt, vm.azure_vm_id);
            // If describe races into NotFound after Start accepted, reconcile ghost —
            // never leave Hub as "starting" on a missing EC2.
            if (desc.state === "not-found") {
              const endedAt = new Date().toISOString();
              await supabase.from("virtual_machines").update({
                status: "failed",
                ended_at: endedAt,
                ended_by: auth.userId,
                ended_reason: "ghost_instance_not_found",
              }).eq("id", targetVmId);
              return new Response(JSON.stringify({
                error: "Cloud instance no longer exists (ghost Hub row reconciled to failed)",
                code: "GHOST_INSTANCE",
                vm_id: targetVmId,
                detail: `InvalidInstanceID.NotFound after Start: ${vm.azure_vm_id}`,
                aws_state: "not-found",
                provider,
                region: vm.region ?? null,
                reconciled_status: "failed",
              }), {
                status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            if (desc.privateIp) ipPatch.private_ip = desc.privateIp;
            if (desc.publicIp) ipPatch.public_ip = desc.publicIp;
          } catch (e) {
            console.error("start-vm AWS IP refresh failed:", e);
          }
        }
        // P0c: reset expires_at on remint from template.duration (non-persistent).
        const expiresPatch = await remintExpiresPatch(supabase, (vm as { lab_template_id?: string | null }).lab_template_id);
        await supabase.from("virtual_machines").update({
          status: "starting",
          ended_by: null,
          ended_reason: null,
          ended_at: null,
          ...ipPatch,
          ...expiresPatch,
        }).eq("id", targetVmId);
        const startReason = actionReason || (isPlatformAdmin ? "admin_start" : "learner_start");
        console.log(JSON.stringify({
          event: "vm_start",
          vm_id: targetVmId,
          actor: auth.userId,
          region: vm.region ?? null,
          provider,
          reason: startReason,
          admin_override: isPlatformAdmin,
        }));
        return new Response(JSON.stringify({
          success: true,
          action: "started",
          vm_id: targetVmId,
          status: "starting",
          reminted: true,
          reason: startReason,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Guarded delete and stop return 423 before any session close or cloud call.
      // There is no admin bypass on delete; remove the VM from the list first.
      if (action === "delete-vm") {
        const blocked = guardedDeleteBlock(vm);
        if (blocked) {
          return new Response(JSON.stringify(blocked), {
            status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (action === "stop-vm" && (isHeldVm(vm, heldVms) || isVmGuarded(vm))) {
        return new Response(JSON.stringify({
          error: "Protected VM — stop blocked",
          code: "VM_PROTECTED",
          vm_id: targetVmId,
        }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "stop-vm") {
        const stopReason = actionReason || "admin_stop";
        noteCloud("stopVmHonest");
        const res = await stopVmHonest(supabase, azureFor, vm as SweepVm, {
          finalStatus: "deallocated",
          reason: stopReason,
          endedBy: auth.userId,
        }, stopBudget);
        if (res.code === "VM_PROTECTED") {
          return new Response(JSON.stringify({
            error: "Protected VM — stop blocked",
            code: "VM_PROTECTED",
            vm_id: targetVmId,
          }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString(), status: "completed" })
          .eq("vm_id", targetVmId)
          .eq("status", "active");
        if (res.pending) await markStopPending(supabase, targetVmId, { reason: stopReason, by: auth.userId });
        await auditSweep(supabase, {
          actorId: auth.userId,
          actorType: "user",
          source: SOURCE,
          vm: vm as SweepVm,
          action: "vm.stop",
          result: stopAuditResult(res),
          reason: stopReason,
          priorStatus: vm.status,
          cloudState: res.cloudState,
          error: res.error ?? null,
          correlationId,
        });
        console.log(JSON.stringify({
          event: "vm_stop",
          vm_id: targetVmId,
          actor: auth.userId,
          reason: stopReason,
          ok: res.ok,
          pending: res.pending === true,
          cloud_state: res.cloudState,
        }));
        if (!res.ok) {
          return new Response(JSON.stringify({
            error: "Cloud stop not confirmed",
            code: "VM_STOP_FAILED",
            vm_id: targetVmId,
            detail: res.error ?? `cloud state=${res.cloudState}`,
            cloud_state: res.cloudState,
            pending: res.pending === true,
          }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString(), status: "completed" })
          .eq("vm_id", targetVmId)
          .eq("status", "active");
        return new Response(JSON.stringify({ success: true, action: "stopped", vm_id: targetVmId, cloud_state: res.cloudState }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "delete-vm") {
        const deleteReason = actionReason || "admin_delete";
        await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString(), status: "completed" })
          .eq("vm_id", targetVmId)
          .eq("status", "active");
        if (vm.azure_vm_id) {
          await deleteCloudVm(supabase, azureFor, vm);
        }
        await markVmEnded(supabase, targetVmId, {
          status: "terminated",
          ended_by: auth.userId,
          ended_reason: deleteReason,
        });
        console.log(JSON.stringify({
          event: "vm_admin_delete",
          vm_id: targetVmId,
          actor: auth.userId,
          reason: deleteReason,
        }));
        return new Response(JSON.stringify({
          success: true,
          action: "deleted",
          vm_id: targetVmId,
          ended_by: auth.userId,
          ended_reason: deleteReason,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle clear-guacamole: remove all connections from Guacamole gateway
    if (action === "clear-guacamole") {
      const GUACAMOLE_URL = Deno.env.get("GUACAMOLE_URL");
      const GUACAMOLE_ADMIN_USERNAME = Deno.env.get("GUACAMOLE_ADMIN_USERNAME");
      const GUACAMOLE_ADMIN_PASSWORD = Deno.env.get("GUACAMOLE_ADMIN_PASSWORD");
      if (!GUACAMOLE_URL || !GUACAMOLE_ADMIN_USERNAME || !GUACAMOLE_ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ error: "Guacamole secrets not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Auth with Guacamole (try with and without /guacamole suffix)
      let guacToken = "";
      let guacBase = "";
      const candidates = [GUACAMOLE_URL.replace(/\/+$/, "")];
      if (!candidates[0].endsWith("/guacamole")) candidates.push(candidates[0] + "/guacamole");
      else candidates.push(candidates[0].replace(/\/guacamole$/, ""));

      for (const base of candidates) {
        const res = await fetch(`${base}/api/tokens`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `username=${encodeURIComponent(GUACAMOLE_ADMIN_USERNAME)}&password=${encodeURIComponent(GUACAMOLE_ADMIN_PASSWORD)}`,
        });
        if (res.ok) {
          const data = await res.json();
          guacToken = data.authToken;
          guacBase = base;
          break;
        }
        await res.text();
      }

      if (!guacToken) {
        return new Response(JSON.stringify({ error: "Failed to authenticate with Guacamole" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get data source
      const dsRes = await fetch(`${guacBase}/api/session/data?token=${guacToken}`);
      const rawSources = dsRes.ok ? await dsRes.json() : {};
      const sources: string[] = Array.isArray(rawSources) ? rawSources : Object.keys(rawSources || {});
      const dataSource = sources.find(s => s === "postgresql") || sources[0] || "postgresql";

      // List all connections
      const connRes = await fetch(`${guacBase}/api/session/data/${dataSource}/connections?token=${guacToken}`);
      const connections = connRes.ok ? await connRes.json() : {};
      const connIds = Object.keys(connections);

      let deleted = 0;
      for (const connId of connIds) {
        const delRes = await fetch(
          `${guacBase}/api/session/data/${dataSource}/connections/${connId}?token=${guacToken}`,
          { method: "DELETE" }
        );
        if (delRes.ok || delRes.status === 204) deleted++;
        else await delRes.text();
      }

      // Also list active sessions
      const activeRes = await fetch(`${guacBase}/api/session/data/${dataSource}/activeConnections?token=${guacToken}`);
      const activeSessions = activeRes.ok ? await activeRes.json() : {};
      const activeIds = Object.keys(activeSessions);

      // Kill active sessions
      for (const activeId of activeIds) {
        await fetch(
          `${guacBase}/api/session/data/${dataSource}/activeConnections/${activeId}?token=${guacToken}`,
          { method: "DELETE" }
        );
      }

      return new Response(JSON.stringify({
        success: true,
        action: "clear-guacamole",
        connections_found: connIds.length,
        connections_deleted: deleted,
        active_sessions_found: activeIds.length,
        active_sessions_killed: activeIds.length,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin dry run (SCRUM-28): which VMs the soft-expiry sweep WOULD deallocate
    // right now, and why. Read-only — no cloud calls, no DB writes.
    if (action === "expiry-preview") {
      const nowMs = Date.now();
      const candidates = await loadSoftExpiryCandidates(supabase);
      const templateCache = new Map<string, SoftExpiryTemplate | null>();
      const usageCache = new Map<string, WalletSessionRow[]>();
      const due: Array<Record<string, unknown>> = [];
      // Past expires_at but persistence unknown → NOT stopped (cautious default).
      const templateUnknown: Array<Record<string, unknown>> = [];
      for (const vm of candidates) {
        const tpl = vm.lab_template_id
          ? await cachedTemplate(supabase, templateCache, vm.lab_template_id)
          : null;
        const sessions = tpl && vm.user_id && vm.lab_template_id
          ? await cachedUsage(supabase, usageCache, vm.user_id, vm.lab_template_id)
          : [];
        const decision = decideSoftExpiry({
          status: vm.status,
          expiresAt: vm.expires_at,
          template: tpl,
          sessions,
          nowMs,
        });
        if (!decision) {
          if (expiresAtSkippedReason({ status: vm.status, expiresAt: vm.expires_at, template: tpl, nowMs }) === "template_unknown") {
            templateUnknown.push({ vm_id: vm.id, status: vm.status, lab_template_id: vm.lab_template_id, expires_at: vm.expires_at });
          }
          continue;
        }
        const held = isHeldVm(vm, heldVms) || isVmGuarded(vm);
        due.push({
          vm_id: vm.id,
          held,
          would_deallocate: !held && softExpiryMode !== "off" && softExpiryEnforced(softExpiryMode, vm.status, decision),
          status: vm.status,
          user_id: vm.user_id,
          lab_template_id: vm.lab_template_id,
          template_name: tpl?.name ?? null,
          expires_at: vm.expires_at,
          template_end_date: tpl?.end_date ?? null,
          ...decision,
        });
      }
      return new Response(JSON.stringify({
        success: true,
        action: "expiry-preview",
        dry_run: true,
        mode: softExpiryMode,
        mode_configured: softExpiryModeConfig.configured,
        mode_warning: softExpiryModeConfig.warning,
        held_vm_ids: heldVms,
        held_vm_warnings: heldConfig.warnings,
        scanned: candidates.length,
        due_count: due.length,
        due,
        template_unknown_count: templateUnknown.length,
        template_unknown: templateUnknown,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // purge-failed is stop-only: no cloud terminate and no row delete.
    // Held/protected rows are not enumerated. delete-vm on a guarded VM is 423.
    if (action === "purge-failed") {
      await auditSweep(supabase, {
        actorId: auth.userId,
        actorType: "user",
        source: SOURCE,
        vm: { id: "00000000-0000-0000-0000-000000000000", azure_vm_id: null },
        action: "vm.terminate_blocked",
        result: "blocked",
        reason: "purge_failed",
        correlationId,
      });
      return new Response(JSON.stringify(TERMINATE_DISABLED), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const idleCutoff = new Date(now.getTime() - IDLE_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const stuckCutoff = new Date(now.getTime() - STUCK_PROVISIONING_MINUTES * 60 * 1000).toISOString();
    const results: string[] = [];

    // 1. Find sessions that are active but idle for 15+ minutes based on last_activity_at
    const { data: idleSessions } = await supabase
      .from("sessions")
      .select("id, vm_id, started_at, idle_minutes, last_activity_at")
      .eq("status", "active")
      .is("ended_at", null)
      .lt("last_activity_at", idleCutoff);

    // 2. Find VMs that are running but their session was ended (stopped labs)
    // NOTE: Exclude "provisioning" VMs — they don't have sessions yet and are handled
    // separately by the stuck-provisioning check (10min timeout)
    //
    // NOTE: the idle, orphan and stuck-provisioning passes run in EVERY
    // SOFT_EXPIRY_MODE (including `off`); that switch only gates the soft-expiry
    // sweep below. Product decision — do not change without Ops sign-off.
    const { data: orphanVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, status, provider_account_id, region, ended_reason, ended_at")
      // + VMs whose learner Cancel could not stop them while `starting` (retry
      // here, with backoff: learner_cancel_pending_stop or …_pending_stop:<n>).
      .or(`status.in.(${ORPHAN_SWEEP_STATUSES.join(",")}),and(status.eq.starting,ended_reason.like.${CANCEL_PENDING_STOP_REASON}*)`)
      .not("azure_vm_id", "is", null);
    const stopRetrySummary: StopRetrySummary = {
      failed: 0,
      escalated_needs_admin: 0,
      backoff_skipped: 0,
      needs_admin_skipped: 0,
      resumed_by_learner_skipped: 0,
    };
    const nowMsForRetry = now.getTime();

    // Check which running VMs have no active session
    const activeSessionVmIds = new Set<string>();
    const { data: activeSessions } = await supabase
      .from("sessions")
      .select("vm_id")
      .eq("status", "active")
      .is("ended_at", null);

    if (activeSessions) {
      activeSessions.forEach((s: { vm_id?: string | null }) => { if (s.vm_id) activeSessionVmIds.add(s.vm_id); });
    }

    // Process idle sessions: end session + deallocate VM
    if (idleSessions?.length) {
      for (const session of idleSessions) {
        let vm: {
          azure_vm_id?: string | null;
          provider_account_id?: string | null;
          region?: string | null;
          ended_reason?: string | null;
          ended_at?: string | null;
        } | null = null;
        if (session.vm_id) {
          const { data } = await supabase
            .from("virtual_machines")
            .select("azure_vm_id, provider_account_id, region, ended_reason, ended_at")
            .eq("id", session.vm_id)
            .maybeSingle();
          vm = data;
          const guardVm = { id: session.vm_id, azure_vm_id: vm?.azure_vm_id ?? null };
          if (isHeldVm(guardVm, heldVms) || isVmGuarded(guardVm)) {
            results.push(`Idle session ${session.id}: VM ${session.vm_id.slice(0, 8)} is held — session left open, not deallocated`);
            continue;
          }
        }

        // End the session only after the guard. A protected VM keeps its row.
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed", disconnect_reason: "idle_timeout" })
          .eq("id", session.id);
        await supabase.from("session_events").insert({
          session_id: session.id,
          event_type: "idle_timeout",
          event_data: { reason: "idle_timeout", ended_by: "cleanup-idle-labs" },
        });

        if (session.vm_id && vm) {
          const idleRetry = effectiveStopRetry(vm.ended_reason, vm.ended_at, nowMsForRetry);

          if (vm?.azure_vm_id && idleRetry?.kind === "needs_admin") {
            // Automatic stops already gave up on this VM; an admin was notified.
            stopRetrySummary.needs_admin_skipped += 1;
            results.push(`Idle session ${session.id}: VM ${session.vm_id.slice(0, 8)} needs admin (stop failed) — not retried`);
          } else if (vm.azure_vm_id) {
            const cloudVm = {
              azure_vm_id: vm.azure_vm_id,
              provider_account_id: vm.provider_account_id,
              region: vm.region,
            };
            // One cloud error must never abort the whole run (soft-expiry below).
            let deallocated = false;
            let stopDetail: string | null = null;
            try {
              deallocated = await stopCloudVm(supabase, azureFor, cloudVm);
              if (!deallocated) stopDetail = "cloud soft-stop returned false";
            } catch (e) {
              stopDetail = e instanceof Error ? e.message : String(e);
              console.error(JSON.stringify({
                event: "idle_deallocate_failed",
                vm_id: session.vm_id,
                detail: stopDetail,
              }));
            }
            if (!deallocated) {
              // Visible to admins on the VM row (+ one notification on escalation).
              await recordStopFailure(supabase, { id: session.vm_id, azure_vm_id: vm.azure_vm_id }, idleRetry, {
                pass: "idle",
                detail: stopDetail,
                nowIso: now.toISOString(),
                summary: stopRetrySummary,
              });
            }
            if (deallocated) {
              await markVmEnded(supabase, session.vm_id, {
                status: "deallocated",
                ended_by: SOURCE,
                ended_reason: "idle_timeout",
                ended_at: now.toISOString(),
              });
              results.push(`Idle session ${session.id}: deallocated VM ${vm.azure_vm_id}`);
            }
          }
        }
      }
    }

    // Process orphan VMs (running but no active session)
    if (orphanVMs?.length) {
      for (const vm of orphanVMs) {
        if (activeSessionVmIds.has(vm.id)) continue; // VM still has active session
        if (!vm.azure_vm_id) continue;
        if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) continue;

        const retry = effectiveStopRetry(vm.ended_reason, vm.ended_at, nowMsForRetry);
        if (retry?.kind === "needs_admin") {
          stopRetrySummary.needs_admin_skipped += 1;
          continue;
        }
        if (!isStopRetryDue(retry, vm.ended_at, nowMsForRetry)) {
          stopRetrySummary.backoff_skipped += 1;
          continue;
        }
        const isCancelRetry = retry?.kind === "cancel";
        if (isCancelRetry) {
          // The learner may have pressed Start ("take back" the Cancel) since the
          // list was read: re-check the marker right before stopping.
          const { data: fresh } = await supabase
            .from("virtual_machines")
            .select("status, ended_reason")
            .eq("id", vm.id)
            .maybeSingle();
          if (!fresh || fresh.ended_reason !== vm.ended_reason || fresh.status !== vm.status) {
            stopRetrySummary.resumed_by_learner_skipped += 1;
            continue;
          }
        }

        // One cloud error (ghost instance, wrong state) must never abort the run.
        let deallocated = false;
        let stopDetail: string | null = null;
        try {
          deallocated = await stopCloudVm(supabase, azureFor, vm);
          if (!deallocated) stopDetail = "cloud soft-stop returned false";
        } catch (e) {
          stopDetail = e instanceof Error ? e.message : String(e);
          console.error(JSON.stringify({
            event: "orphan_deallocate_failed",
            vm_id: vm.id,
            detail: stopDetail,
          }));
        }
        if (!deallocated) {
          // Recorded on the VM row (visible on /vms) with backoff; escalates to
          // stop_failed_needs_admin + one admin notification after N attempts.
          await recordStopFailure(supabase, vm, retry, {
            pass: isCancelRetry ? "cancel_retry" : "orphan",
            detail: stopDetail,
            nowIso: now.toISOString(),
            summary: stopRetrySummary,
          });
        }
        if (deallocated) {
          await markVmEnded(supabase, vm.id, {
            status: "deallocated",
            ended_by: SOURCE,
            ended_reason: isCancelRetry ? "learner_cancel_kept" : "orphan_no_session",
            ended_at: now.toISOString(),
          });
          results.push(`Orphan VM ${vm.azure_vm_id}: deallocated${isCancelRetry ? " (Cancel pending-stop retry)" : ""}`);
        }
      }
    }

    // 3. Soft-expiry sweep (SCRUM-28) — ONE pass over every VM that may still
    // bill compute (running / provisioning / starting / idle / OS-stopped).
    // Triggers (see _shared/lab-expiry.ts): VM expires_at passed, persistent
    // template end_date (EOD IST) passed, or prepaid minutes used up.
    // Soft path only: end sessions + deallocate + notify. NEVER a silent
    // terminate/delete. Runs after the idle/orphan passes so VMs they already
    // deallocated are not processed twice.
    // TODO(v2): soft-hold purge — days after lab_window_expired deallocate, optionally
    // hard-delete cloud + DB under explicit admin / ALLOW_AUTO_TERMINATE. Parked.
    const expirySummary = {
      mode: softExpiryMode,
      // Raw secret + warning when an unknown value failed safe to dry-run.
      mode_configured: softExpiryModeConfig.configured,
      mode_warning: softExpiryModeConfig.warning,
      template_unknown_skipped: 0,
      scanned: 0,
      due: 0,
      deallocated: 0,
      stop_failed: 0,
      held_skipped: 0,
      dry_run_due: 0,
    };
    try {
      if (softExpiryMode === "off") throw new SkipSweep();
      const nowMs = now.getTime();
      const candidates = await loadSoftExpiryCandidates(supabase);
      expirySummary.scanned = candidates.length;
      const templateCache = new Map<string, SoftExpiryTemplate | null>();
      const usageCache = new Map<string, WalletSessionRow[]>();

      for (const vm of candidates) {
        const tpl = vm.lab_template_id
          ? await cachedTemplate(supabase, templateCache, vm.lab_template_id)
          : null;
        const sessions = tpl && vm.user_id && vm.lab_template_id
          ? await cachedUsage(supabase, usageCache, vm.user_id, vm.lab_template_id)
          : [];
        const decision = decideSoftExpiry({
          status: vm.status,
          expiresAt: vm.expires_at,
          template: tpl,
          sessions,
          nowMs,
        });
        if (!decision) {
          if (expiresAtSkippedReason({ status: vm.status, expiresAt: vm.expires_at, template: tpl, nowMs }) === "template_unknown") {
            expirySummary.template_unknown_skipped += 1;
            console.warn(JSON.stringify({
              event: "soft_expiry_template_unknown",
              vm_id: vm.id,
              lab_template_id: vm.lab_template_id,
              expires_at: vm.expires_at,
            }));
          }
          continue;
        }
        expirySummary.due += 1;
        if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) {
          expirySummary.held_skipped += 1;
          continue;
        }
        if (!softExpiryEnforced(softExpiryMode, vm.status, decision)) {
          expirySummary.dry_run_due += 1;
          console.log(JSON.stringify({
            event: "soft_expiry_dry_run_due",
            mode: softExpiryMode,
            vm_id: vm.id,
            status: vm.status,
            reason: decision.reason,
            trigger: decision.trigger,
          }));
          continue;
        }

        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed", disconnect_reason: decision.reason })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        let cloudOk = true;
        let stopDetail: string | null = null;
        if (vm.azure_vm_id) {
          const cloudVm = { ...vm, azure_vm_id: vm.azure_vm_id };
          try {
            cloudOk = await stopCloudVm(supabase, azureFor, cloudVm);
            if (!cloudOk) stopDetail = "cloud soft-stop returned false";
          } catch (e) {
            cloudOk = false;
            stopDetail = e instanceof Error ? e.message : String(e);
            console.error("soft-expiry deallocate failed", e);
          }
          if (!cloudOk) {
            try {
              const recon = await isCloudAlreadySoftStopped(supabase, azureFor, cloudVm);
              // An Azure OS-level "stopped" VM is still allocated (billed) — only a
              // real deallocate may clear it. AWS stopped is already soft-stopped.
              const reconOk = recon.softStopped && recon.detail !== "azure mapped=stopped";
              if (reconOk) {
                cloudOk = true;
                stopDetail = stopDetail ? `${stopDetail}; reconciled: ${recon.detail}` : `reconciled: ${recon.detail}`;
              }
            } catch (e) {
              console.error("soft-expiry reconcile failed", e);
            }
          }
        }

        const label = vm.azure_vm_id ? extractVmName(vm.azure_vm_id) : vm.id.slice(0, 8);
        // Honesty gate: mark Hub deallocated only when cloud soft-stop (or reconcile) succeeded.
        if (cloudOk) {
          await markVmEnded(supabase, vm.id, {
            status: "deallocated",
            ended_by: SOURCE,
            ended_reason: decision.reason,
            ended_at: now.toISOString(),
          });
          const notice = softExpiryNotice(decision, label, tpl?.name ?? null);
          await notifyLearnerAndAdmins(supabase, { userId: vm.user_id, ...notice });
          expirySummary.deallocated += 1;
          console.log(JSON.stringify({
            event: "soft_expiry_deallocated",
            vm_id: vm.id,
            prior_status: vm.status,
            reason: decision.reason,
            trigger: decision.trigger,
            detail: stopDetail,
          }));
          results.push(`Soft-expiry ${label}: ${decision.trigger} (was ${vm.status}) → deallocated`);
        } else {
          expirySummary.stop_failed += 1;
          console.error(JSON.stringify({
            event: "soft_expiry_stop_failed",
            vm_id: vm.id,
            prior_status: vm.status,
            reason: decision.reason,
            trigger: decision.trigger,
            detail: stopDetail,
          }));
          results.push(
            `Soft-expiry ${label}: cloud stop failed — Hub status left as ${vm.status}${stopDetail ? ` [${stopDetail.slice(0, 120)}]` : ""}`,
          );
        }
      }
    } catch (e) {
      if (!(e instanceof SkipSweep)) console.error("Soft-expiry sweep failed:", e);
    }

    // 3b. Pre-expiry warning (T-15m): notify learner+admins once per lab window.
    try {
      const warnHorizon = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const { data: soonExpiring } = await supabase
        .from("virtual_machines")
        .select("id, user_id, azure_vm_id, expires_at")
        .in("status", ["running", "provisioning", "starting", "idle"])
        .not("expires_at", "is", null)
        .gt("expires_at", now.toISOString())
        .lte("expires_at", warnHorizon)
        .is("expiry_warned_at", null)
        .limit(100);

      for (const vm of soonExpiring ?? []) {
        if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) continue;
        const label = vm.azure_vm_id ? extractVmName(vm.azure_vm_id) : vm.id.slice(0, 8);
        await notifyLearnerAndAdmins(supabase, {
          userId: vm.user_id,
          type: "lab_expiry_warning",
          title: "Lab expires in ~15 minutes",
          message: `Lab VM ${label} expires at ${vm.expires_at}. Save work now — at expiry the VM will be deallocated (not deleted).`,
        });
        await supabase.from("virtual_machines").update({
          expiry_warned_at: now.toISOString(),
        }).eq("id", vm.id);
        results.push(`Pre-expiry warn: ${label}`);
      }
    } catch (e) {
      console.error("Pre-expiry T-15m warn failed:", e);
    }

    // 4. Stuck 'provisioning' (10+ min): Azure-check FIRST.
    // If PowerState/running → promote to running (+ IP). NEVER deallocate a live Lex hold.
    // Only fail/soft-dealloc when Azure is still creating / failed / not found / unavailable.
    const { data: stuckVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, created_at, provider_account_id, private_ip, region")
      .eq("status", "provisioning")
      .lt("created_at", stuckCutoff);

    if (stuckVMs?.length) {
      for (const vm of stuckVMs) {
        if (isHeldVm(vm, heldVms) || isVmGuarded(vm)) continue;
        let promoted = false;
        if (vm.azure_vm_id) {
          try {
            const provider = await providerOf(supabase, vm.provider_account_id);
            if (provider === "aws") {
              const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
              if (vm.region) aws.defaultRegion = String(vm.region);
              const desc = await describeAwsInstance(aws, vm.azure_vm_id);
              if (desc.state === "running") {
                await applyPromoteToRunning(supabase, vm.id, desc.privateIp, desc.publicIp);
                promoted = true;
                results.push(
                  `Stuck provisioning VM ${vm.id.substring(0, 8)}: AWS running → promoted to running (no stop)`,
                );
              } else if (
                desc.state === "terminated" ||
                desc.state === "shutting-down" ||
                desc.state === "not-found"
              ) {
                await markVmEnded(supabase, vm.id, {
                  status: "failed",
                  ended_by: SOURCE,
                  ended_reason: desc.state === "not-found"
                    ? "ghost_instance_not_found"
                    : "stuck_provisioning",
                  ended_at: now.toISOString(),
                });
                results.push(
                  `Stuck provisioning VM ${vm.id.substring(0, 8)}: AWS ${desc.state} → marked failed`,
                );
                continue;
              }
            } else {
              const az = await azureFor(vm.provider_account_id);
              const outcome = await reconcileProvisioningAgainstAzure(az, {
                azureVmId: vm.azure_vm_id,
                currentPrivateIp: vm.private_ip ?? null,
              });
              if (outcome.kind === "promoted") {
                await applyPromoteToRunning(supabase, vm.id, outcome.private_ip, outcome.public_ip);
                promoted = true;
                results.push(
                  `Stuck provisioning VM ${vm.id.substring(0, 8)}: Azure Running → promoted to running (no dealloc)`,
                );
              } else if (outcome.kind === "mapped" && outcome.status === "failed") {
                await markVmEnded(supabase, vm.id, {
                  status: "failed",
                  ended_by: SOURCE,
                  ended_reason: "stuck_provisioning",
                  ended_at: now.toISOString(),
                });
                results.push(`Stuck provisioning VM ${vm.id.substring(0, 8)}: Azure failed → marked failed`);
                continue;
              }
            }
          } catch (e) {
            console.error("stuck provisioning cloud reconcile failed", e);
          }
        }

        if (promoted) continue;

        // Soft: deallocate if present — do not hard-delete outside admin/cancel/purge paths.
        if (vm.azure_vm_id) {
          try {
            await stopCloudVm(supabase, azureFor, vm);
          } catch (e) {
            console.error("stuck provisioning deallocate failed", e);
          }
        }
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed" })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        await markVmEnded(supabase, vm.id, {
          status: "failed",
          ended_by: SOURCE,
          ended_reason: "stuck_provisioning",
          ended_at: now.toISOString(),
        });
        results.push(`Stuck provisioning VM ${vm.id.substring(0, 8)}: marked failed (created ${vm.created_at})`);
      }
    }

    // 5. Check Azure quota and send notifications to admins if > 80%
    try {
      const az = await azureFor(null);
      const quotaRes = await fetch(
        `https://management.azure.com/subscriptions/${az.subscriptionId}/providers/Microsoft.Compute/locations/eastus/usages?api-version=2024-03-01`,
        { headers: { Authorization: `Bearer ${az.token}` } }
      );
      if (quotaRes.ok) {
        const quotaData = await quotaRes.json();
        const relevant = quotaData.value?.filter((u: any) =>
          ["cores", "standardBSFamily"].includes(u.name?.value)
        ) || [];

        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        const adminIds = adminRoles?.map((r: any) => r.user_id) || [];

        for (const q of relevant) {
          const pct = q.limit > 0 ? Math.round((q.currentValue / q.limit) * 100) : 0;
          if (pct >= 80 && adminIds.length > 0) {
            const severity = pct >= 95 ? "critical" : "warning";
            const notifications = adminIds.map((uid: string) => ({
              user_id: uid,
              type: severity === "critical" ? "quota_critical" : "quota_warning",
              title: `${severity === "critical" ? "⚠️ Quota Critical" : "Quota Warning"}: ${q.name?.localizedValue || q.name?.value}`,
              message: `East US — ${q.currentValue}/${q.limit} cores used (${pct}%).${severity === "critical" ? " Students cannot launch new labs." : " Consider cleaning up unused VMs."}`,
            }));
            await supabase.from("notifications").insert(notifications);
            results.push(`Quota alert (${severity}): ${q.name?.value} at ${pct}%`);
          }
        }
      }
    } catch (e) {
      console.error("Quota check for notifications failed:", e);
    }

    // 6. Cleanup Guacamole connections + scoped users for any completed sessions
    //    that still have lingering guac metadata (per-session resource cleanup).
    try {
      const { data: orphanGuacSessions } = await supabase
        .from("sessions")
        .select("id, guac_connection_id, guac_username")
        .neq("status", "active")
        .or("guac_connection_id.not.is.null,guac_username.not.is.null")
        .limit(200);

      if (orphanGuacSessions?.length) {
        const GUACAMOLE_URL = Deno.env.get("GUACAMOLE_URL");
        const GUACAMOLE_ADMIN_USERNAME = Deno.env.get("GUACAMOLE_ADMIN_USERNAME");
        const GUACAMOLE_ADMIN_PASSWORD = Deno.env.get("GUACAMOLE_ADMIN_PASSWORD");

        if (GUACAMOLE_URL && GUACAMOLE_ADMIN_USERNAME && GUACAMOLE_ADMIN_PASSWORD) {
          const candidates = [GUACAMOLE_URL.replace(/\/+$/, "")];
          if (!candidates[0].endsWith("/guacamole")) candidates.push(candidates[0] + "/guacamole");
          else candidates.push(candidates[0].replace(/\/guacamole$/, ""));

          let guacToken = "", guacBase = "";
          for (const base of candidates) {
            const r = await fetch(`${base}/api/tokens`, {
              method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `username=${encodeURIComponent(GUACAMOLE_ADMIN_USERNAME)}&password=${encodeURIComponent(GUACAMOLE_ADMIN_PASSWORD)}`,
            });
            if (r.ok) { const d = await r.json(); guacToken = d.authToken; guacBase = base; break; }
            await r.text();
          }

          if (guacToken) {
            // Resolve data source
            let dataSource = "postgresql";
            const dsRes = await fetch(`${guacBase}/api/session/data?token=${guacToken}`);
            if (dsRes.ok) {
              const raw = await dsRes.json();
              const sources: string[] = Array.isArray(raw) ? raw : Object.keys(raw || {});
              dataSource = sources.find((s) => s === "postgresql") || sources[0] || "postgresql";
            }

            let cleaned = 0;
            for (const s of orphanGuacSessions) {
              if (s.guac_connection_id) {
                await fetch(`${guacBase}/api/session/data/${dataSource}/connections/${s.guac_connection_id}?token=${guacToken}`, { method: "DELETE" }).catch(() => {});
              }
              if (s.guac_username) {
                await fetch(`${guacBase}/api/session/data/${dataSource}/users/${encodeURIComponent(s.guac_username)}?token=${guacToken}`, { method: "DELETE" }).catch(() => {});
              }
              await supabase.from("sessions")
                .update({ guac_connection_id: null, guac_username: null })
                .eq("id", s.id);
              cleaned++;
            }
            // Revoke admin token
            await fetch(`${guacBase}/api/tokens/${guacToken}`, { method: "DELETE" }).catch(() => {});
            if (cleaned) results.push(`Guacamole cleanup: removed ${cleaned} orphan session(s)`);
          }
        }
      }
    } catch (e) {
      console.error("Guacamole orphan cleanup failed:", e);
    }

    // 7. Expire access_sessions whose expires_at has passed
    try {
      const { data: expired } = await supabase
        .from("access_sessions")
        .select("id, provider, provider_session_ref")
        .in("status", ["created", "active"])
        .lt("expires_at", new Date().toISOString())
        .limit(500);

      if (expired?.length) {
        const { revokeSession: awsRevoke } = await import("../_shared/cloud-providers/aws.ts");
        const { revokeSession: azureRevoke } = await import("../_shared/cloud-providers/azure.ts");
        const { revokeSession: gcpRevoke } = await import("../_shared/cloud-providers/gcp.ts");
        for (const s of expired) {
          try {
            if (s.provider === "aws") await awsRevoke(s.provider_session_ref);
            else if (s.provider === "azure") await azureRevoke(s.provider_session_ref);
            else await gcpRevoke(s.provider_session_ref);
          } catch (e) { console.warn(`revoke failed for session ${s.id}:`, e); }
          await supabase.from("access_sessions").update({
            status: "expired",
            ended_at: new Date().toISOString(),
          }).eq("id", s.id);
          await supabase.from("access_session_events").insert({
            session_id: s.id,
            event_type: "session.expired",
            payload: { reason: "expires_at_reached" },
          });
        }
        results.push(`Access sessions expired: ${expired.length}`);
      }
    } catch (e) {
      console.error("access_sessions expiry sweep failed:", e);
    }

    console.log(`Cleanup completed: ${results.length} actions taken`, results);



    return new Response(
      JSON.stringify({
        success: true,
        actions_taken: results.length,
        details: results,
        idle_timeout_minutes: IDLE_TIMEOUT_MINUTES,
        soft_expiry: expirySummary,
        stop_retry: stopRetrySummary,
        held_vm_warnings: heldConfig.warnings,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("cleanup-idle-labs error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Skip the listener only when a test sets both flags. CLEANUP_SKIP_SERVE alone
// must not stop a production or `supabase functions serve` process.
if (Deno.env.get("DENO_TESTING") !== "1" || Deno.env.get("CLEANUP_SKIP_SERVE") !== "1") {
  Deno.serve((req) => handleCleanupRequest(req));
}
