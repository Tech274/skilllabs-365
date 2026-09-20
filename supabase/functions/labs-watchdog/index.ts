// Orphan/expiry watchdog.
//
// Scans for labs and sessions that are past their expires_at (or hopelessly
// stuck) and triggers an idempotent soft cleanup for each one.
// Soft-expiry policy (Atlas GO): deallocate + DB deallocated + notify —
// NEVER silently hard-delete Azure VMs on lab window expiry.
// Hard delete only when ALLOW_AUTO_TERMINATE=true (off by default) or via
// admin delete-vm / cancel-provisioning / purge-failed in cleanup-idle-labs.
// Safe to run every minute: every action is guarded by a deterministic
// idempotency key so repeated runs never double-act or double-log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeadersFor, requireAdmin, jsonResponse, errorResponse } from "../_shared/auth.ts";
import { correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, releaseIdempotency } from "../_shared/idempotency.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import {
  resolveAwsRuntime,
  describeAwsInstance,
  stopAwsInstance,
  terminateAwsInstance,
} from "../_shared/cloud-providers/aws-runtime.ts";
import {
  reconcileProvisioningAgainstAzure,
  applyPromoteToRunning,
} from "../_shared/azure-reconcile.ts";

const SOURCE = "labs-watchdog";
const WATCHDOG_USER = "00000000-0000-0000-0000-000000000000";
const STUCK_PROVISIONING_MINUTES = 20;
const MAX_PER_RUN = 50;

/** When true, expiry/stuck paths may hard-delete Azure VMs. Default: off. */
function allowAutoTerminate(): boolean {
  const v = (Deno.env.get("ALLOW_AUTO_TERMINATE") || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
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

async function deallocateAzureVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
): Promise<boolean> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/deallocate?api-version=2024-03-01`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`watchdog: deallocate VM ${vmName} failed: ${await res.text()}`);
    return false;
  }
  return true;
}

async function deleteAzureVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
): Promise<boolean> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=2024-03-01&forceDeletion=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    console.error(`watchdog: delete VM ${vmName} failed: ${await res.text()}`);
    return false;
  }
  return true;
}

function extractVmName(azureVmId: string): string {
  return azureVmId.includes("/") ? azureVmId.split("/").pop()! : azureVmId;
}

async function markVmEnded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  vmId: string,
  patch: { status: string; ended_by: string; ended_reason: string; ended_at: string },
) {
  await supabase.from("virtual_machines").update({
    status: patch.status,
    ended_by: patch.ended_by,
    ended_reason: patch.ended_reason,
    ended_at: patch.ended_at,
  }).eq("id", vmId);
}

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
  if (error) console.error("watchdog notify failed:", error.message);
}

interface WatchdogVm {
  id: string;
  user_id: string | null;
  lab_template_id: string | null;
  azure_vm_id: string | null;
  status: string;
  expires_at: string | null;
  provider_account_id: string | null;
  region?: string | null;
  created_at?: string | null;
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

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* scheduled invocation without body */ }

  const dryRun = body.dry_run === true;

  // Scheduled runs authenticate with the cron shared secret; humans must be admins.
  const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
  }

  const correlationId = correlationIdFrom(req);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return errorResponse("Backend not configured", 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const nowIso = now.toISOString();
  const stuckCutoff = new Date(now.getTime() - STUCK_PROVISIONING_MINUTES * 60_000).toISOString();
  const warnHorizon = new Date(now.getTime() + 15 * 60_000).toISOString();
  const actions: string[] = [];
  const skipped: string[] = [];
  const hardDeleteAllowed = allowAutoTerminate();

  try {
    // 0. Pre-expiry warning (T-15m) — cheap, before soft-expiry cleanup.
    if (!dryRun) {
      const { data: soonExpiring } = await supabase
        .from("virtual_machines")
        .select("id, user_id, azure_vm_id, expires_at")
        .in("status", ["provisioning", "starting", "running"])
        .not("expires_at", "is", null)
        .gt("expires_at", nowIso)
        .lte("expires_at", warnHorizon)
        .is("expiry_warned_at", null)
        .limit(MAX_PER_RUN);

      for (const vm of soonExpiring ?? []) {
        const label = vm.azure_vm_id ? extractVmName(vm.azure_vm_id) : vm.id.slice(0, 8);
        await notifyLearnerAndAdmins(supabase, {
          userId: vm.user_id,
          type: "lab_expiry_warning",
          title: "Lab expires in ~15 minutes",
          message: `Lab VM ${label} expires at ${vm.expires_at}. Save work now — at expiry the VM will be deallocated (not deleted).`,
        });
        await supabase.from("virtual_machines").update({ expiry_warned_at: nowIso }).eq("id", vm.id);
        actions.push(`vm ${vm.id.slice(0, 8)}: pre-expiry warn`);
      }
    }

    // 0b. Reconcile DB status=provisioning|starting → running when cloud instance is Running.
    // Azure: PowerState/running. AWS: EC2 instance-state running.
    // Prevents Lex-soak / learner holds / Start-from-deallocated from staying
    // "provisioning"/"starting" forever when the client never polls check-vm-status
    // (or promote was RLS-blocked / check-vm-status ignored starting).
    if (!dryRun) {
      const { data: provisioningVms } = await supabase
        .from("virtual_machines")
        .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at, provider_account_id, private_ip, region, created_at")
        .in("status", ["provisioning", "starting"])
        .not("azure_vm_id", "is", null)
        .limit(MAX_PER_RUN);

      const azureCacheEarly = new Map<string, Promise<{ token: string; subscriptionId: string; resourceGroup: string }>>();
      const azureForEarly = (accountId?: string | null) => {
        const key = accountId ?? "__default__";
        let entry = azureCacheEarly.get(key);
        if (!entry) {
          entry = (async () => {
            const rt = await resolveAzureRuntime(supabase, accountId ?? null);
            return {
              token: await getAzureToken(rt.tenantId, rt.clientId, rt.clientSecret),
              subscriptionId: rt.subscriptionId,
              resourceGroup: rt.resourceGroup,
            };
          })();
          azureCacheEarly.set(key, entry);
        }
        return entry;
      };

      for (const vm of provisioningVms ?? []) {
        try {
          const provider = await providerOf(supabase, vm.provider_account_id);
          if (provider === "aws") {
            const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
            if (vm.region) aws.defaultRegion = String(vm.region);
            const desc = await describeAwsInstance(aws, vm.azure_vm_id);
            if (desc.state === "running") {
              await applyPromoteToRunning(supabase, vm.id, desc.privateIp);
              actions.push(`vm ${vm.id.slice(0, 8)}: reconciled aws ${vm.status}→running`);
            } else if (desc.state === "terminated" || desc.state === "shutting-down") {
              await supabase.from("virtual_machines").update({ status: "failed" }).eq("id", vm.id);
              actions.push(`vm ${vm.id.slice(0, 8)}: reconciled aws ${vm.status}→failed`);
            } else if (desc.state === "stopped" || desc.state === "stopping") {
              // Do not regress Start-from-deallocated "starting" while StartInstances is pending.
              if (vm.status === "starting") {
                actions.push(`vm ${vm.id.slice(0, 8)}: aws still stopped during starting — hold`);
              } else {
                await supabase.from("virtual_machines").update({ status: "stopped" }).eq("id", vm.id);
                actions.push(`vm ${vm.id.slice(0, 8)}: reconciled aws ${vm.status}→stopped`);
              }
            }
            continue;
          }

          const az = await azureForEarly(vm.provider_account_id);
          const outcome = await reconcileProvisioningAgainstAzure(az, {
            azureVmId: vm.azure_vm_id,
            currentPrivateIp: vm.private_ip ?? null,
          });
          if (outcome.kind === "promoted") {
            await applyPromoteToRunning(supabase, vm.id, outcome.private_ip);
            actions.push(`vm ${vm.id.slice(0, 8)}: reconciled ${vm.status}→running`);
          } else if (outcome.kind === "mapped" && (outcome.status === "failed" || outcome.status === "deallocated" || outcome.status === "stopped")) {
            // Mirror check-vm-status: sync terminal Azure states into Hub,
            // but hold Start-from-deallocated while Azure still reports stopped/deallocated.
            if (
              vm.status === "starting" &&
              (outcome.status === "stopped" || outcome.status === "deallocated")
            ) {
              actions.push(`vm ${vm.id.slice(0, 8)}: azure ${outcome.status} during starting — hold`);
            } else {
              await supabase.from("virtual_machines").update({ status: outcome.status }).eq("id", vm.id);
              actions.push(`vm ${vm.id.slice(0, 8)}: reconciled ${vm.status}→${outcome.status}`);
            }
          }
        } catch (e) {
          console.error(`watchdog reconcile ${vm.id}:`, e);
          skipped.push(`vm ${vm.id.slice(0, 8)}: reconcile-error`);
        }
      }
    }

    // 1. Labs past expires_at, plus labs wedged in provisioning far too long.
    const { data: expiredVms } = await supabase
      .from("virtual_machines")
      .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at, provider_account_id, region, created_at")
      .in("status", ["provisioning", "starting", "running", "deallocated"])
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .limit(MAX_PER_RUN);

    const { data: stuckVms } = await supabase
      .from("virtual_machines")
      .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at, provider_account_id, region, created_at")
      .eq("status", "provisioning")
      .lt("created_at", stuckCutoff)
      .limit(MAX_PER_RUN);

    // Tag reason per target
    const reasons = new Map<string, string>();
    const targets = new Map<string, WatchdogVm>();
    for (const vm of (expiredVms ?? []) as WatchdogVm[]) {
      // Skip already-deallocated that only need DB metadata if already ended for expiry —
      // still process if status is deallocated but expires_at passed without ended_reason
      // (idempotency key handles repeats). Prefer soft path for running/provisioning/starting.
      if (vm.status === "deallocated") {
        // Already soft-held; do not re-act unless hard-delete gate is on (v2 soft-hold purge).
        // TODO(v2): soft-hold purge days later under ALLOW_AUTO_TERMINATE / admin.
        skipped.push(`vm ${vm.id.slice(0, 8)}: already deallocated (soft-hold; purge parked v2)`);
        continue;
      }
      targets.set(vm.id, vm);
      reasons.set(vm.id, "lab_window_expired");
    }
    for (const vm of (stuckVms ?? []) as WatchdogVm[]) {
      if (!targets.has(vm.id)) {
        targets.set(vm.id, vm);
        reasons.set(vm.id, "stuck_provisioning");
      }
    }

    // 2. Active sessions whose VM already died or whose expiry passed.
    const { data: expiredSessions } = await supabase
      .from("sessions")
      .select("id, vm_id, user_id, expires_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .limit(MAX_PER_RUN);

    if (dryRun) {
      return jsonResponse({
        dry_run: true,
        correlation_id: correlationId,
        allow_auto_terminate: hardDeleteAllowed,
        expired_vms: [...targets.keys()],
        expired_sessions: (expiredSessions ?? []).map((s) => s.id),
        policy: "soft_expiry_deallocate",
      });
    }

    // Close expired sessions first so the UI stops showing them as live.
    for (const s of expiredSessions ?? []) {
      await supabase
        .from("sessions")
        .update({ status: "completed", ended_at: nowIso })
        .eq("id", s.id)
        .eq("status", "active");
      actions.push(`session ${s.id.slice(0, 8)}: closed (expired)`);
      if (s.vm_id && !targets.has(s.vm_id)) {
        const { data: vm } = await supabase
          .from("virtual_machines")
          .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at, provider_account_id, region, created_at")
          .eq("id", s.vm_id)
          .not("status", "in", "(terminated,failed,deallocated)")
          .maybeSingle();
        if (vm) {
          targets.set(vm.id, vm as WatchdogVm);
          reasons.set(vm.id, "lab_window_expired");
        }
      }
    }

    // Azure credentials always come from the Resource Providers registry, keyed
    // by the account that provisioned each VM.
    const azureCache = new Map<string, Promise<{ token: string; subscriptionId: string; resourceGroup: string }>>();
    const azureFor = (accountId?: string | null) => {
      const key = accountId ?? "__default__";
      let entry = azureCache.get(key);
      if (!entry) {
        entry = (async () => {
          const rt = await resolveAzureRuntime(supabase, accountId ?? null);
          return {
            token: await getAzureToken(rt.tenantId, rt.clientId, rt.clientSecret),
            subscriptionId: rt.subscriptionId,
            resourceGroup: rt.resourceGroup,
          };
        })();
        azureCache.set(key, entry);
      }
      return entry;
    };

    for (const vm of targets.values()) {
      // Deterministic key: one cleanup per VM per expiry window, ever.
      const endedReason = reasons.get(vm.id) || "lab_window_expired";
      const key = `watchdog:${vm.id}:${vm.expires_at ?? "stuck"}:soft`;
      const userId = vm.user_id ?? WATCHDOG_USER;
      const claim = await claimIdempotency(supabase, {
        key,
        userId,
        action: "watchdog-cleanup",
        correlationId,
      });
      if (claim.outcome !== "new") {
        skipped.push(`vm ${vm.id.slice(0, 8)}: ${claim.outcome}`);
        continue;
      }

      const timeline = new ProvisioningTimeline(supabase, {
        correlationId,
        userId: vm.user_id,
        vmId: vm.id,
        labTemplateId: vm.lab_template_id,
      });

      try {
        await timeline.start(SOURCE, "watchdog-cleanup", "Expired/stuck lab detected — soft releasing resources", {
          previous_status: vm.status,
          expires_at: vm.expires_at,
          ended_reason: endedReason,
          allow_auto_terminate: hardDeleteAllowed,
        });

        await supabase
          .from("sessions")
          .update({ status: "completed", ended_at: nowIso })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        let azureDeallocated = false;
        let azureDeleted = false;
        let nextStatus = hardDeleteAllowed ? "terminated" : "deallocated";
        let promotedRunning = false;
        let privateIp: string | null = null;

        // CRITICAL (Lex soak): stuck_provisioning must cloud-check FIRST.
        // If instance is Running → promote DB to running (+ IP); NEVER deallocate/stop.
        // Only fail/soft-release when still creating / failed / not found.
        const cloudProvider = await providerOf(supabase, vm.provider_account_id);
        if (endedReason === "stuck_provisioning" && vm.azure_vm_id) {
          try {
            if (cloudProvider === "aws") {
              const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
              if (vm.region) aws.defaultRegion = String(vm.region);
              const desc = await describeAwsInstance(aws, vm.azure_vm_id);
              if (desc.state === "running") {
                await applyPromoteToRunning(supabase, vm.id, desc.privateIp);
                promotedRunning = true;
                privateIp = desc.privateIp;
                nextStatus = "running";
                await timeline.success(SOURCE, "watchdog-reconcile", "Stuck provisioning was actually AWS running — promoted to running", {
                  private_ip: privateIp,
                });
                const response = {
                  success: true,
                  vm_id: vm.id,
                  azure_deallocated: false,
                  azure_deleted: false,
                  status: "running",
                  ended_reason: "reconciled_running",
                  correlation_id: correlationId,
                  private_ip: privateIp,
                };
                await completeIdempotency(supabase, { key, userId, action: "watchdog-cleanup", response });
                actions.push(`vm ${vm.id.slice(0, 8)}: stuck→running (aws instance running; no stop)`);
                continue;
              }
              await timeline.start(SOURCE, "watchdog-cleanup", `Stuck provisioning AWS state=${desc.state} — releasing`, {
                aws_state: desc.state,
              });
            } else {
              const az = await azureFor(vm.provider_account_id);
              const outcome = await reconcileProvisioningAgainstAzure(az, {
                azureVmId: vm.azure_vm_id,
                currentPrivateIp: null,
              });
              if (outcome.kind === "promoted") {
                await applyPromoteToRunning(supabase, vm.id, outcome.private_ip);
                promotedRunning = true;
                privateIp = outcome.private_ip;
                nextStatus = "running";
                await timeline.success(SOURCE, "watchdog-reconcile", "Stuck provisioning was actually Azure Running — promoted to running", {
                  private_ip: privateIp,
                });
                const response = {
                  success: true,
                  vm_id: vm.id,
                  azure_deallocated: false,
                  azure_deleted: false,
                  status: "running",
                  ended_reason: "reconciled_running",
                  correlation_id: correlationId,
                  private_ip: privateIp,
                };
                await completeIdempotency(supabase, { key, userId, action: "watchdog-cleanup", response });
                actions.push(`vm ${vm.id.slice(0, 8)}: stuck→running (azure PowerState/running; no dealloc)`);
                continue;
              }
              // mapped failed/stopped/deallocated or still_provisioning / unavailable → fall through to soft/hard release
              if (outcome.kind === "mapped") {
                await timeline.start(SOURCE, "watchdog-cleanup", `Stuck provisioning Azure mapped to ${outcome.status} — releasing`, {
                  azure_mapped: outcome.status,
                });
              }
            }
          } catch (e) {
            await timeline.failed(
              SOURCE,
              cloudProvider === "aws" ? "aws-reconcile" : "azure-reconcile",
              e instanceof Error ? e.message : "Cloud reconcile failed; proceeding to soft release",
            );
          }
        }

        if (!promotedRunning && vm.azure_vm_id) {
          try {
            if (cloudProvider === "aws") {
              const aws = await resolveAwsRuntime(supabase, vm.provider_account_id);
              if (vm.region) aws.defaultRegion = String(vm.region);
              if (hardDeleteAllowed) {
                await terminateAwsInstance(aws, vm.azure_vm_id);
                azureDeleted = true;
              } else {
                await stopAwsInstance(aws, vm.azure_vm_id);
                azureDeallocated = true;
              }
            } else {
              const az = await azureFor(vm.provider_account_id);
              const vmName = extractVmName(vm.azure_vm_id);
              if (hardDeleteAllowed) {
                // Explicit opt-in only — never the default expiry path.
                azureDeleted = await deleteAzureVM(az.token, az.subscriptionId, az.resourceGroup, vmName);
              } else {
                azureDeallocated = await deallocateAzureVM(az.token, az.subscriptionId, az.resourceGroup, vmName);
              }
            }
          } catch (e) {
            await timeline.failed(
              SOURCE,
              hardDeleteAllowed
                ? (cloudProvider === "aws" ? "aws-terminate" : "azure-delete")
                : (cloudProvider === "aws" ? "aws-stop" : "azure-deallocate"),
              e instanceof Error ? e.message : "Cloud action failed",
            );
          }
        }

        // Soft path: always deallocated (even if Azure call failed / no azure_vm_id)
        // so we never leave status running and never mark terminated without an explicit delete.
        // Hard path (ALLOW_AUTO_TERMINATE): terminated only when delete was attempted.
        // (Skipped when we already promoted stuck→running above.)
        await markVmEnded(supabase, vm.id, {
          status: nextStatus,
          ended_by: SOURCE,
          ended_reason: endedReason,
          ended_at: nowIso,
        });

        const label = vm.azure_vm_id ? extractVmName(vm.azure_vm_id) : vm.id.slice(0, 8);
        await notifyLearnerAndAdmins(supabase, {
          userId: vm.user_id,
          type: endedReason === "stuck_provisioning" ? "lab_stuck" : "lab_expired",
          title: hardDeleteAllowed
            ? "Lab terminated by watchdog"
            : "Lab window expired — VM deallocated",
          message: hardDeleteAllowed
            ? `Lab VM ${label} was hard-terminated (ALLOW_AUTO_TERMINATE). Reason: ${endedReason}.`
            : `Lab VM ${label} was soft-stopped (deallocated). Reason: ${endedReason}. Resources are held, not deleted.`,
        });

        const response = {
          success: true,
          vm_id: vm.id,
          azure_deallocated: azureDeallocated,
          azure_deleted: azureDeleted,
          status: nextStatus,
          ended_reason: endedReason,
          correlation_id: correlationId,
        };
        await completeIdempotency(supabase, { key, userId, action: "watchdog-cleanup", response });
        await timeline.success(SOURCE, "watchdog-cleanup", hardDeleteAllowed
          ? "Expired lab terminated by watchdog (ALLOW_AUTO_TERMINATE)"
          : "Expired lab soft-deallocated by watchdog", {
          azure_deallocated: azureDeallocated,
          azure_deleted: azureDeleted,
          status: nextStatus,
        });
        actions.push(
          `vm ${vm.id.slice(0, 8)}: ${nextStatus}` +
            (azureDeleted ? " (azure deleted)" : azureDeallocated ? " (azure deallocated)" : " (db only)"),
        );
      } catch (e) {
        await releaseIdempotency(supabase, { key, userId, action: "watchdog-cleanup" });
        await timeline.failed(SOURCE, "watchdog-cleanup", e instanceof Error ? e.message : "Watchdog cleanup failed");
        actions.push(`vm ${vm.id.slice(0, 8)}: FAILED`);
      }
    }

    // Expire stale public-cloud access sessions too.
    const { data: expiredAccess } = await supabase
      .from("access_sessions")
      .select("id")
      .in("status", ["created", "active"])
      .lt("expires_at", nowIso)
      .limit(MAX_PER_RUN);
    for (const s of expiredAccess ?? []) {
      await supabase.from("access_sessions").update({ status: "expired", ended_at: nowIso }).eq("id", s.id);
      await supabase.from("access_session_events").insert({
        session_id: s.id,
        event_type: "session.expired",
        payload: { reason: "watchdog_expires_at" },
      });
      actions.push(`access session ${s.id.slice(0, 8)}: expired`);
    }

    return jsonResponse({
      success: true,
      correlation_id: correlationId,
      cleaned: actions.length,
      actions,
      skipped,
      checked_at: nowIso,
      allow_auto_terminate: hardDeleteAllowed,
      policy: "soft_expiry_deallocate",
    });
  } catch (e) {
    console.error("labs-watchdog failed:", e);
    return errorResponse(e instanceof Error ? e.message : "Watchdog run failed", 500);
  }
});
