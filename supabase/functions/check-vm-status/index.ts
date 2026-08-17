import { corsHeadersFor, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { azureStatusToVmStatus } from "../_shared/vm-state.ts";
import { serviceClient } from "../_shared/cloud-providers/accounts.ts";
import { getAzureToken } from "../_shared/azure-preflight.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const supabase = auth.supabase;

    const { vm_id } = await req.json();
    if (!vm_id) return errorResponse("vm_id is required", 400);

    // Get VM record
    const { data: vm } = await supabase.from("virtual_machines").select("*").eq("id", vm_id).maybeSingle();
    if (!vm) return errorResponse("VM not found", 404);

    const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
    if (forbidden) return forbidden;

    if (vm.status !== "provisioning") {
      return jsonResponse({ status: vm.status });
    }

    // Extract VM name from azure_vm_id
    const azureVmId = vm.azure_vm_id;
    if (!azureVmId) {
      return jsonResponse({ status: "provisioning" });
    }
    const vmName = azureVmId.split("/").pop()!;

    // Credentials come from the Resource Providers registry that created this VM.
    const admin = serviceClient();
    const azure = await resolveAzureRuntime(admin, vm.provider_account_id);
    const azureToken = await getAzureToken(azure.tenantId, azure.clientId, azure.clientSecret);

    // Check VM instance view
    const ivRes = await fetch(
      `https://management.azure.com/subscriptions/${azure.subscriptionId}/resourceGroups/${azure.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/instanceView?api-version=2024-03-01`,
      { headers: { Authorization: `Bearer ${azureToken}` } },
    );

    if (!ivRes.ok) {
      return jsonResponse({ status: "provisioning" });
    }

    const ivData = await ivRes.json();
    const statuses = ivData.statuses || [];
    const mapped = azureStatusToVmStatus(statuses);

    if (mapped === "running") {
      // Get updated private IP
      const nicName = `${vmName}-nic`;
      const nicRes = await fetch(
        `https://management.azure.com/subscriptions/${azure.subscriptionId}/resourceGroups/${azure.resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2024-03-01`,
        { headers: { Authorization: `Bearer ${azureToken}` } },
      );
      let privateIp = vm.private_ip;
      if (nicRes.ok) {
        const nicData = await nicRes.json();
        privateIp = nicData?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress || privateIp;
      }

      await supabase.from("virtual_machines").update({ status: "running", private_ip: privateIp }).eq("id", vm_id);
      return jsonResponse({ status: "running", private_ip: privateIp });
    }

    if (mapped === "failed" || mapped === "deallocated" || mapped === "stopped") {
      await supabase.from("virtual_machines").update({ status: mapped }).eq("id", vm_id);
      return jsonResponse({ status: mapped });
    }

    return jsonResponse({ status: "provisioning" });
  } catch (error: unknown) {
    console.error("check-vm-status error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
