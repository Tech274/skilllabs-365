import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID")!;
    const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
    const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
    const AZURE_SUBSCRIPTION_ID = Deno.env.get("AZURE_SUBSCRIPTION_ID")!;
    const AZURE_RESOURCE_GROUP = Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Parse optional body for manual trigger
    let action = "auto-cleanup";
    let targetVmId: string | null = null;
    try {
      const body = await req.json();
      action = body.action || action;
      targetVmId = body.vm_id || null;
    } catch { /* no body = scheduled run */ }

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

      // End any active sessions for this VM
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
    const { data: orphanVMs } = await supabase
      .from("virtual_machines")
      .select("id, azure_vm_id, status")
      .in("status", ["running", "provisioning"])
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
