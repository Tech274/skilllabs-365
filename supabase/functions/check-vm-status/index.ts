import { corsHeadersFor, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/cloud-providers/accounts.ts";
import { getAzureToken } from "../_shared/azure-preflight.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import {
  reconcileProvisioningAgainstAzure,
  applyPromoteToRunning,
} from "../_shared/azure-reconcile.ts";
import { resolveAwsRuntime, describeAwsInstance } from "../_shared/cloud-providers/aws-runtime.ts";
import { reconcileWritesEnabled, reconcileVms, type ReconcileVm } from "../_shared/vm-reconcile.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { vm_id } = await req.json();
    if (!vm_id) return errorResponse("vm_id is required", 400);

    const admin = serviceClient();
    const { data: vm } = await admin.from("virtual_machines").select("*").eq("id", vm_id).maybeSingle();
    if (!vm) return errorResponse("VM not found", 404);

    const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
    if (forbidden) return forbidden;

    const applyReconcile = reconcileWritesEnabled();

    // P2a reconcile is report-only unless VM_RECONCILE_MODE=apply or
    // VM_RECONCILE_DRY_RUN=false. The call still describes the cloud.
    let drift: Record<string, unknown> | null = null;
    if (vm.azure_vm_id) {
      try {
        const [r] = await reconcileVms(admin, [vm as ReconcileVm], {
          source: "check-vm-status",
          dryRun: !applyReconcile,
        });
        if (applyReconcile && r) {
          return jsonResponse({
            status: r.after.status,
            public_ip: r.after.public_ip,
            private_ip: r.after.private_ip,
            changed: r.changed,
            code: r.code ?? null,
            ...(r.would_be ? { drift: { cloud_state: r.cloud_state, would_be: r.would_be } } : {}),
          });
        }
        if (r?.would_be) {
          drift = { cloud_state: r.cloud_state, would_be: r.would_be, code: r.code ?? null };
        }
      } catch (e) {
        console.error("check-vm-status reconcile (report) failed:", e instanceof Error ? e.message : e);
      }
    }

    // Live promotion path (main): only provisioning|starting rows are written
    // here. Other statuses return as stored. Opt-in reconcile above replaces
    // this path when writes are enabled.
    if (vm.status !== "provisioning" && vm.status !== "starting") {
      return jsonResponse({ status: vm.status, ...(drift ? { drift } : {}) });
    }

    if (!vm.azure_vm_id) {
      return jsonResponse({ status: vm.status });
    }

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
      if (vm.region) aws.defaultRegion = String(vm.region);
      const desc = await describeAwsInstance(aws, vm.azure_vm_id);
      if (desc.state === "running") {
        await applyPromoteToRunning(admin, vm_id, desc.privateIp, desc.publicIp);
        return jsonResponse({
          status: "running",
          private_ip: desc.privateIp,
          public_ip: desc.publicIp,
        });
      }
      if (desc.state === "terminated" || desc.state === "shutting-down") {
        await admin.from("virtual_machines").update({ status: "failed" }).eq("id", vm_id);
        return jsonResponse({ status: "failed" });
      }
      if (desc.state === "stopped" || desc.state === "stopping") {
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
      await applyPromoteToRunning(admin, vm_id, outcome.private_ip, outcome.public_ip);
      return jsonResponse({
        status: "running",
        private_ip: outcome.private_ip,
        public_ip: outcome.public_ip,
      });
    }

    if (outcome.kind === "mapped") {
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
