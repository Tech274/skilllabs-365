import { corsHeadersFor, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/cloud-providers/accounts.ts";
import { getAzureToken } from "../_shared/azure-preflight.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import {
  reconcileProvisioningAgainstAzure,
  applyPromoteToRunning,
} from "../_shared/azure-reconcile.ts";

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

    if (!vm.azure_vm_id) {
      return jsonResponse({ status: "provisioning" });
    }

    // Credentials come from the Resource Providers registry that created this VM.
    const admin = serviceClient();
    const azure = await resolveAzureRuntime(admin, vm.provider_account_id);
    const azureToken = await getAzureToken(azure.tenantId, azure.clientId, azure.clientSecret);

    const outcome = await reconcileProvisioningAgainstAzure(
      {
        token: azureToken,
        subscriptionId: azure.subscriptionId,
        resourceGroup: azure.resourceGroup,
      },
      { azureVmId: vm.azure_vm_id, currentPrivateIp: vm.private_ip },
    );

    if (outcome.kind === "promoted") {
      await applyPromoteToRunning(supabase, vm_id, outcome.private_ip);
      return jsonResponse({ status: "running", private_ip: outcome.private_ip });
    }

    if (outcome.kind === "mapped") {
      await supabase.from("virtual_machines").update({ status: outcome.status }).eq("id", vm_id);
      return jsonResponse({ status: outcome.status });
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
