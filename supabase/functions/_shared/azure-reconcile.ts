// Shared Azure instanceView → Hub DB reconcile for provisioning VMs.
// Used by check-vm-status, labs-watchdog, and cleanup-idle-labs so stuck
// paths never deallocate a VM that Azure already reports as Running.
import { azureStatusToVmStatus, type VmStatus } from "./vm-state.ts";

export interface AzureReconcileCtx {
  token: string;
  subscriptionId: string;
  resourceGroup: string;
}

export type ReconcileOutcome =
  | { kind: "promoted"; status: "running"; private_ip: string | null }
  | { kind: "mapped"; status: Exclude<VmStatus, "running" | "provisioning"> }
  | { kind: "still_provisioning" }
  | { kind: "azure_unavailable"; detail?: string }
  | { kind: "no_azure_id" };

function extractVmName(azureVmId: string): string {
  return azureVmId.includes("/") ? azureVmId.split("/").pop()! : azureVmId;
}

/** Fetch instanceView statuses for a VM; null if Azure call fails. */
export async function fetchInstanceViewStatuses(
  ctx: AzureReconcileCtx,
  vmName: string,
): Promise<Array<{ code?: string; level?: string }> | null> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/instanceView?api-version=2024-03-01`,
    { headers: { Authorization: `Bearer ${ctx.token}` } },
  );
  if (!res.ok) {
    console.error(`azure-reconcile: instanceView ${vmName} failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  return data.statuses || [];
}

/** Best-effort NIC private IP lookup (same naming as check-vm-status). */
export async function fetchNicPrivateIp(
  ctx: AzureReconcileCtx,
  vmName: string,
  fallback: string | null = null,
): Promise<string | null> {
  const nicName = `${vmName}-nic`;
  try {
    const nicRes = await fetch(
      `https://management.azure.com/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2024-03-01`,
      { headers: { Authorization: `Bearer ${ctx.token}` } },
    );
    if (!nicRes.ok) return fallback;
    const nicData = await nicRes.json();
    return nicData?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Azure-first reconcile for a DB row stuck (or still) in `provisioning`.
 * If PowerState/running → promote DB to running (+ private_ip).
 * Never deallocates; callers decide fail/soft-dealloc only when Azure is NOT running.
 */
export async function reconcileProvisioningAgainstAzure(
  ctx: AzureReconcileCtx,
  opts: {
    azureVmId: string | null | undefined;
    currentPrivateIp?: string | null;
  },
): Promise<ReconcileOutcome> {
  if (!opts.azureVmId) return { kind: "no_azure_id" };

  const vmName = extractVmName(opts.azureVmId);
  let statuses: Array<{ code?: string; level?: string }> | null;
  try {
    statuses = await fetchInstanceViewStatuses(ctx, vmName);
  } catch (e) {
    return {
      kind: "azure_unavailable",
      detail: e instanceof Error ? e.message : "instanceView failed",
    };
  }
  if (!statuses) {
    return { kind: "azure_unavailable", detail: "instanceView not ok" };
  }

  const mapped = azureStatusToVmStatus(statuses);
  if (mapped === "running") {
    const privateIp = await fetchNicPrivateIp(ctx, vmName, opts.currentPrivateIp ?? null);
    return { kind: "promoted", status: "running", private_ip: privateIp };
  }
  if (mapped === "failed" || mapped === "deallocated" || mapped === "stopped") {
    return { kind: "mapped", status: mapped };
  }
  // provisioning / null / transitional → treat as still provisioning
  return { kind: "still_provisioning" };
}

/**
 * Apply a successful promote to the virtual_machines row.
 * Returns true if update was issued.
 */
export async function applyPromoteToRunning(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  vmId: string,
  privateIp: string | null,
): Promise<boolean> {
  const patch: Record<string, unknown> = { status: "running" };
  if (privateIp) patch.private_ip = privateIp;
  const { error } = await supabase.from("virtual_machines").update(patch).eq("id", vmId);
  if (error) {
    console.error(`azure-reconcile: promote ${vmId} failed:`, error.message);
    return false;
  }
  return true;
}
