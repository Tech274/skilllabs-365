import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, requireAdmin } from "../_shared/auth.ts";

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
  // Delete VM (NIC and disk have deleteOption: Delete so they'll be cleaned up)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse optional body for manual trigger (before auth so we can branch on action)
    let action = "auto-cleanup";
    let targetVmId: string | null = null;
    try {
      const body = await req.json();
      action = body.action || action;
      targetVmId = body.vm_id || null;
    } catch { /* no body = scheduled run */ }

    // `cancel-provisioning` is the only student-callable action: it is scoped to
    // the caller's own VM. Everything else stays admin / service-role only.
    const auth = action === "cancel-provisioning"
      ? await requireUser(req)
      : await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID")!;
    const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
    const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
    const AZURE_SUBSCRIPTION_ID = Deno.env.get("AZURE_SUBSCRIPTION_ID")!;
    const AZURE_RESOURCE_GROUP = Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg";

    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Student-owned cancellation of a provisioning / running VM
    if (action === "cancel-provisioning") {
      if (!targetVmId) return errorResponse("vm_id required", 400);

      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status, user_id")
        .eq("id", targetVmId)
        .maybeSingle();
      if (!vm) return errorResponse("VM not found", 404);

      const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
      if (forbidden) return forbidden;

      await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString(), status: "completed" })
        .eq("vm_id", targetVmId)
        .eq("status", "active");

      if (vm.azure_vm_id) {
        try {
          const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
          await deleteAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, extractVmName(vm.azure_vm_id));
        } catch (e) {
          console.error("cancel-provisioning: azure delete failed", e);
        }
      }

      await supabase.from("virtual_machines").update({ status: "terminated" }).eq("id", targetVmId);
      return jsonResponse({ success: true, action: "cancelled", vm_id: targetVmId });
    }

    // Handle targeted stop/delete actions
    if ((action === "stop-vm" || action === "delete-vm") && targetVmId) {
      const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status")
        .eq("id", targetVmId)
        .maybeSingle();

      if (!vm) {
        return new Response(JSON.stringify({ error: "VM not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString(), status: "completed" })
        .eq("vm_id", targetVmId)
        .eq("status", "active");

      if (action === "stop-vm") {
        if (vm.azure_vm_id) {
          const vmName = extractVmName(vm.azure_vm_id);
          await deallocateAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
        }
        await supabase.from("virtual_machines").update({ status: "deallocated" }).eq("id", targetVmId);
        return new Response(JSON.stringify({ success: true, action: "stopped", vm_id: targetVmId }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "delete-vm") {
        if (vm.azure_vm_id) {
          const vmName = extractVmName(vm.azure_vm_id);
          await deleteAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
        }
        await supabase.from("virtual_machines").update({ status: "terminated" }).eq("id", targetVmId);
        return new Response(JSON.stringify({ success: true, action: "deleted", vm_id: targetVmId }), {
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

    // Handle purge: delete all failed/terminated VM records from database
    if (action === "purge-failed") {
      const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

      // First clean up any Azure resources that might still exist
      const { data: purgeVMs } = await supabase
        .from("virtual_machines")
        .select("id, azure_vm_id, status")
        .in("status", ["failed", "terminated"]);

      let purged = 0;
      if (purgeVMs?.length) {
        for (const vm of purgeVMs) {
          if (vm.azure_vm_id) {
            const vmName = extractVmName(vm.azure_vm_id);
            await deleteAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
          }
          // Delete the DB record entirely
          await supabase.from("virtual_machines").delete().eq("id", vm.id);
          purged++;
        }
      }

      return new Response(JSON.stringify({ success: true, action: "purged", count: purged }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const { data: orphanVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, status")
      .eq("status", "running")
      .not("azure_vm_id", "is", null);

    // Check which running VMs have no active session
    const activeSessionVmIds = new Set<string>();
    const { data: activeSessions } = await supabase
      .from("sessions")
      .select("vm_id")
      .eq("status", "active")
      .is("ended_at", null);

    if (activeSessions) {
      activeSessions.forEach((s) => { if (s.vm_id) activeSessionVmIds.add(s.vm_id); });
    }

    // 3. Find expired VMs
    const { data: expiredVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, status, expires_at")
      .in("status", ["running", "provisioning"])
      .not("azure_vm_id", "is", null)
      .lt("expires_at", now.toISOString());

    // Get Azure token once for all operations
    const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

    // Process idle sessions: end session + deallocate VM
    if (idleSessions?.length) {
      for (const session of idleSessions) {
        // End the session
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed" })
          .eq("id", session.id);

        if (session.vm_id) {
          // Get VM details
          const { data: vm } = await supabase
            .from("virtual_machines")
            .select("azure_vm_id")
            .eq("id", session.vm_id)
            .maybeSingle();

          if (vm?.azure_vm_id) {
            const vmName = extractVmName(vm.azure_vm_id);
            const deallocated = await deallocateAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
            if (deallocated) {
              await supabase.from("virtual_machines").update({ status: "deallocated" }).eq("id", session.vm_id);
              results.push(`Idle session ${session.id}: deallocated VM ${vmName}`);
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

        const vmName = extractVmName(vm.azure_vm_id);
        const deallocated = await deallocateAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
        if (deallocated) {
          await supabase.from("virtual_machines").update({ status: "deallocated" }).eq("id", vm.id);
          results.push(`Orphan VM ${vmName}: deallocated`);
        }
      }
    }

    // Process expired VMs
    if (expiredVMs?.length) {
      for (const vm of expiredVMs) {
        if (!vm.azure_vm_id) continue;

        // End any active sessions for this VM
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed" })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        const vmName = extractVmName(vm.azure_vm_id);
        const deleted = await deleteAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
        if (deleted) {
          await supabase.from("virtual_machines").update({ status: "terminated" }).eq("id", vm.id);
          results.push(`Expired VM ${vmName}: deleted`);
        }
      }
    }

    // 4. Mark VMs stuck in 'provisioning' for 10+ minutes as 'failed'
    const { data: stuckVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, created_at")
      .eq("status", "provisioning")
      .lt("created_at", stuckCutoff);

    if (stuckVMs?.length) {
      for (const vm of stuckVMs) {
        // If it has an Azure VM, try to clean it up
        if (vm.azure_vm_id) {
          const vmName = extractVmName(vm.azure_vm_id);
          await deleteAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName);
        }
        // End any sessions tied to this VM
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString(), status: "completed" })
          .eq("vm_id", vm.id)
          .eq("status", "active");

        await supabase.from("virtual_machines").update({ status: "failed" }).eq("id", vm.id);
        results.push(`Stuck provisioning VM ${vm.id.substring(0, 8)}: marked failed (created ${vm.created_at})`);
      }
    }

    // 5. Check Azure quota and send notifications to admins if > 80%
    try {
      const quotaRes = await fetch(
        `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Compute/locations/eastus/usages?api-version=2024-03-01`,
        { headers: { Authorization: `Bearer ${azureToken}` } }
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
});
