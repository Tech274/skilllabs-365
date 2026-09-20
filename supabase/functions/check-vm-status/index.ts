import { corsHeadersFor, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/cloud-providers/accounts.ts";
import { getAzureToken } from "../_shared/azure-preflight.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import {
  reconcileProvisioningAgainstAzure,
  applyPromoteToRunning,
} from "../_shared/azure-reconcile.ts";
import { resolveAwsRuntime, describeAwsInstance } from "../_shared/cloud-providers/aws-runtime.ts";

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

    const { data: vm } = await supabase.from("virtual_machines").select("*").eq("id", vm_id).maybeSingle();
    if (!vm) return errorResponse("VM not found", 404);

    const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
    if (forbidden) return forbidden;

    // Promote both fresh provision AND Start-from-deallocated (status=starting).
    // Admin Start / persistent remint set "starting" after cloud StartInstances;
    // without this gate Hub stays Starting forever (same class of bug as PR #22 RLS).
    if (vm.status !== "provisioning" && vm.status !== "starting") {
      return jsonResponse({ status: vm.status });
    }

    if (!vm.azure_vm_id) {
      return jsonResponse({ status: vm.status });
    }

    const admin = serviceClient();

    // Resolve which cloud owns this VM via its provider account.
    let provider = "azure";
    if (vm.provider_account_id) {
      const { data: acct } = await admin
        .from("cloud_provider_accounts")
        .select("provider")
        .eq("id", vm.provider_account_id)
        .maybeSingle();
      if (acct?.provider) provider = String(acct.provider);
    }

    // Status writes MUST use the service role. Learners only have SELECT on
    // virtual_machines (RLS: "Users view own VMs"); admin FOR ALL is admin-only.
    // Promoting with the user JWT silently no-ops → Hub stays "provisioning"
    // forever even when EC2/Azure is already Running (loadtest02 prv_ca91e584).
    if (provider === "aws") {
      const aws = await resolveAwsRuntime(admin, vm.provider_account_id);
      // Prefer the VM's stored region when present
      if (vm.region) aws.defaultRegion = String(vm.region);
      const desc = await describeAwsInstance(aws, vm.azure_vm_id);
      if (desc.state === "running") {
        await applyPromoteToRunning(admin, vm_id, desc.privateIp);
        return jsonResponse({ status: "running", private_ip: desc.privateIp });
      }
      if (desc.state === "terminated" || desc.state === "shutting-down") {
        await admin.from("virtual_machines").update({ status: "failed" }).eq("id", vm_id);
        return jsonResponse({ status: "failed" });
      }
      if (desc.state === "stopped" || desc.state === "stopping") {
        // StartInstances in flight can still report stopped briefly — do not
        // regress Hub "starting" back to stopped (Start-from-deallocated).
        if (vm.status === "starting") {
          return jsonResponse({ status: "starting" });
        }
        await admin.from("virtual_machines").update({ status: "stopped" }).eq("id", vm_id);
        return jsonResponse({ status: "stopped" });
      }
      return jsonResponse({ status: vm.status });
    }

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
      await applyPromoteToRunning(admin, vm_id, outcome.private_ip);
      return jsonResponse({ status: "running", private_ip: outcome.private_ip });
    }

    if (outcome.kind === "mapped") {
      // Same Start-in-flight guard for Azure deallocate/stopped flicker.
      if (
        vm.status === "starting" &&
        (outcome.status === "stopped" || outcome.status === "deallocated")
      ) {
        return jsonResponse({ status: "starting" });
      }
      await admin.from("virtual_machines").update({ status: outcome.status }).eq("id", vm_id);
      return jsonResponse({ status: outcome.status });
    }

    return jsonResponse({ status: vm.status });
  } catch (error: unknown) {
    console.error("check-vm-status error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
