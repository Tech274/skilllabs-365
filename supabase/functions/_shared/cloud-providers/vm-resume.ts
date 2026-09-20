/**
 * Persistent lab REMINT / resume.
 *
 * Disconnect is not deallocate. A learner who stops, leaves or returns inside the
 * grant + template window must get the SAME allocation back: we start the existing
 * VM instead of creating a new one (and never destroy it on Start).
 *
 * Only the soft-expiry job (end_date EOD IST, or minutes exhausted for
 * non-persistent labs) deallocates + notifies — never a silent terminate.
 */

import { ec2Action, resolveAwsRuntime } from "./aws-runtime.ts";
import { resolveAzureRuntime } from "./azure-runtime.ts";

type SupabaseLike = {
  from: (table: string) => any;
};

/** Statuses that mean "allocation exists, compute is simply off". */
export const RESUMABLE_VM_STATUSES = ["deallocated", "stopped"] as const;
/** Statuses that mean "allocation exists and is live" — hand it straight back. */
export const LIVE_VM_STATUSES = ["provisioning", "starting", "running", "idle"] as const;

export type ResumableVm = {
  id: string;
  status: string;
  azure_vm_id: string | null;
  private_ip: string | null;
  provider_account_id: string | null;
  expires_at: string | null;
};

/** Newest reusable VM this learner already holds for this template, if any. */
export async function findResumableVm(
  supabase: SupabaseLike,
  args: { userId: string; labTemplateId: string },
): Promise<ResumableVm | null> {
  const { data } = await supabase
    .from("virtual_machines")
    .select("id, status, azure_vm_id, private_ip, provider_account_id, expires_at")
    .eq("user_id", args.userId)
    .eq("lab_template_id", args.labTemplateId)
    .in("status", [...LIVE_VM_STATUSES, ...RESUMABLE_VM_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ResumableVm | null) ?? null;
}

function extractAzureVmName(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

async function azureToken(rt: { tenantId: string; clientId: string; clientSecret: string }): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${rt.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: rt.clientId,
      client_secret: rt.clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure token request failed (${res.status})`);
  return (await res.json()).access_token as string;
}

/**
 * Power the existing allocation back on. Returns true when the cloud accepted the
 * start; the VM row is never deleted or recreated here.
 */
export async function startCloudVm(
  supabase: SupabaseLike,
  provider: string,
  vm: ResumableVm,
): Promise<boolean> {
  if (!vm.azure_vm_id) return false;

  if (provider === "aws") {
    const rt = await resolveAwsRuntime(supabase, vm.provider_account_id);
    const res = await ec2Action(rt, "StartInstances", { "InstanceId.1": vm.azure_vm_id });
    if (!res.ok) {
      console.error(`StartInstances failed (${res.status}): ${res.text.slice(0, 300)}`);
      return false;
    }
    return true;
  }

  const rt = await resolveAzureRuntime(supabase, vm.provider_account_id);
  const token = await azureToken(rt);
  const name = extractAzureVmName(vm.azure_vm_id);
  const res = await fetch(
    `https://management.azure.com/subscriptions/${rt.subscriptionId}/resourceGroups/${rt.resourceGroup}` +
      `/providers/Microsoft.Compute/virtualMachines/${name}/start?api-version=2023-03-01`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`Azure start failed for ${name} (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}
