// Orphan/expiry watchdog.
//
// Scans for labs and sessions that are past their expires_at (or hopelessly
// stuck) and triggers an idempotent cancellation + Azure cleanup for each one.
// Safe to run every minute: every action is guarded by a deterministic
// idempotency key so repeated runs never delete twice or double-log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeadersFor, requireAdmin, jsonResponse, errorResponse } from "../_shared/auth.ts";
import { correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, releaseIdempotency } from "../_shared/idempotency.ts";

const SOURCE = "labs-watchdog";
const WATCHDOG_USER = "00000000-0000-0000-0000-000000000000";
const STUCK_PROVISIONING_MINUTES = 20;
const MAX_PER_RUN = 50;

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

interface WatchdogVm {
  id: string;
  user_id: string | null;
  lab_template_id: string | null;
  azure_vm_id: string | null;
  status: string;
  expires_at: string | null;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* scheduled invocation without body */ }

  const dryRun = body.dry_run === true;
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

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
  const actions: string[] = [];
  const skipped: string[] = [];

  try {
    // 1. Labs past expires_at, plus labs wedged in provisioning far too long.
    const { data: expiredVms } = await supabase
      .from("virtual_machines")
      .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at")
      .in("status", ["provisioning", "starting", "running", "deallocated"])
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .limit(MAX_PER_RUN);

    const { data: stuckVms } = await supabase
      .from("virtual_machines")
      .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at")
      .eq("status", "provisioning")
      .lt("created_at", stuckCutoff)
      .limit(MAX_PER_RUN);

    const targets = new Map<string, WatchdogVm>();
    for (const vm of [...(expiredVms ?? []), ...(stuckVms ?? [])] as WatchdogVm[]) targets.set(vm.id, vm);

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
        expired_vms: [...targets.keys()],
        expired_sessions: (expiredSessions ?? []).map((s) => s.id),
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
          .select("id, user_id, lab_template_id, azure_vm_id, status, expires_at")
          .eq("id", s.vm_id)
          .not("status", "in", "(terminated,failed)")
          .maybeSingle();
        if (vm) targets.set(vm.id, vm as WatchdogVm);
      }
    }

    let azureToken: string | null = null;
    const tenant = Deno.env.get("AZURE_TENANT_ID");
    const clientId = Deno.env.get("AZURE_CLIENT_ID");
    const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET");
    const subscription = Deno.env.get("AZURE_SUBSCRIPTION_ID");
    const resourceGroup = Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg";

    for (const vm of targets.values()) {
      // Deterministic key: one cleanup per VM per expiry window, ever.
      const key = `watchdog:${vm.id}:${vm.expires_at ?? "stuck"}`;
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
        await timeline.start(SOURCE, "watchdog-cleanup", "Expired lab detected — releasing resources", {
          previous_status: vm.status,
          expires_at: vm.expires_at,
        });

        await supabase
          .from("sessions")
          .update({ status: "completed", ended_at: nowIso })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        let azureDeleted = false;
        if (vm.azure_vm_id) {
          if (tenant && clientId && clientSecret && subscription) {
            try {
              azureToken ??= await getAzureToken(tenant, clientId, clientSecret);
              azureDeleted = await deleteAzureVM(azureToken, subscription, resourceGroup, extractVmName(vm.azure_vm_id));
            } catch (e) {
              await timeline.failed(SOURCE, "azure-delete", e instanceof Error ? e.message : "Azure delete failed");
            }
          } else {
            await timeline.skipped(SOURCE, "azure-delete", "Azure credentials not configured");
          }
        }

        await supabase.from("virtual_machines").update({ status: "terminated" }).eq("id", vm.id);
        const response = { success: true, vm_id: vm.id, azure_deleted: azureDeleted, correlation_id: correlationId };
        await completeIdempotency(supabase, { key, userId, action: "watchdog-cleanup", response });
        await timeline.success(SOURCE, "watchdog-cleanup", "Expired lab terminated by watchdog", {
          azure_deleted: azureDeleted,
        });
        actions.push(`vm ${vm.id.slice(0, 8)}: terminated${azureDeleted ? " (azure deleted)" : ""}`);
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
    });
  } catch (e) {
    console.error("labs-watchdog failed:", e);
    return errorResponse(e instanceof Error ? e.message : "Watchdog run failed", 500);
  }
});
