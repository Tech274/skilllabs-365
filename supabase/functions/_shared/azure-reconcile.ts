// Shared Azure instanceView → Hub DB reconcile for provisioning VMs.
// Used by check-vm-status, labs-watchdog, and cleanup-idle-labs so stuck
// paths never deallocate a VM that Azure already reports as Running.
import { azureStatusToVmStatus, type VmStatus } from "./vm-state.ts";
import {
  armResourceUrl,
  azureNicName,
  readArmIpAddress,
  readNicPrivateIp,
  readNicPublicIpRef,
} from "./azure-public-ip.ts";

export interface AzureReconcileCtx {
  token: string;
  subscriptionId: string;
  resourceGroup: string;
}

export type ReconcileOutcome =
  | { kind: "promoted"; status: "running"; private_ip: string | null; public_ip: string | null }
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

export interface NicAddresses {
  privateIp: string | null;
  publicIp: string | null;
  /** True when the NIC ipConfiguration references a publicIPAddresses resource. */
  publicIpAttached: boolean;
}

/**
 * Private IP plus the associated Standard public IP (second GET on the PIP
 * when the NIC payload does not inline `ipAddress`).
 */
export async function fetchNicAddresses(
  ctx: AzureReconcileCtx,
  vmName: string,
  fallbackPrivate: string | null = null,
): Promise<NicAddresses> {
  const empty: NicAddresses = {
    privateIp: fallbackPrivate,
    publicIp: null,
    publicIpAttached: false,
  };
  const nicName = azureNicName(vmName);
  try {
    const nicRes = await fetch(
      armResourceUrl(
        `/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}`,
      ),
      { headers: { Authorization: `Bearer ${ctx.token}` } },
    );
    if (!nicRes.ok) return empty;
    const nicData = await nicRes.json();
    const privateIp = readNicPrivateIp(nicData) || fallbackPrivate;
    const pip = readNicPublicIpRef(nicData);
    if (pip.address) {
      return { privateIp, publicIp: pip.address, publicIpAttached: true };
    }
    if (!pip.resourceId) {
      return { privateIp, publicIp: null, publicIpAttached: false };
    }
    const pipRes = await fetch(armResourceUrl(pip.resourceId), {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    if (!pipRes.ok) {
      return { privateIp, publicIp: null, publicIpAttached: true };
    }
    const pipData = await pipRes.json();
    return {
      privateIp,
      publicIp: readArmIpAddress(pipData),
      publicIpAttached: true,
    };
  } catch {
    return empty;
  }
}

/** Best-effort NIC private IP lookup (same naming as check-vm-status). */
export async function fetchNicPrivateIp(
  ctx: AzureReconcileCtx,
  vmName: string,
  fallback: string | null = null,
): Promise<string | null> {
  const addrs = await fetchNicAddresses(ctx, vmName, fallback);
  return addrs.privateIp;
}

/**
 * Azure-first reconcile for a DB row stuck (or still) in `provisioning`.
 * If PowerState/running → promote DB to running (+ private_ip + public_ip).
 * Never deallocates; callers decide fail/soft-dealloc only when Azure is NOT running.
 */
export async function reconcileProvisioningAgainstAzure(
  ctx: AzureReconcileCtx,
  opts: {
    azureVmId: string | null | undefined;
    currentPrivateIp?: string | null;
    /** Delay before one PIP re-read when the NIC is associated but the address is not yet populated. */
    publicIpRetryMs?: number;
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
    let addrs = await fetchNicAddresses(ctx, vmName, opts.currentPrivateIp ?? null);
    // Static PIP allocation can lag the first NIC read by a moment. Retry once
    // only when a PIP is attached, so legacy private-only NICs promote immediately.
    if (!addrs.publicIp && addrs.publicIpAttached) {
      const waitMs = opts.publicIpRetryMs ?? 1000;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      addrs = await fetchNicAddresses(ctx, vmName, opts.currentPrivateIp ?? null);
    }
    return {
      kind: "promoted",
      status: "running",
      private_ip: addrs.privateIp,
      public_ip: addrs.publicIp,
    };
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
  publicIp?: string | null,
): Promise<boolean> {
  const patch: Record<string, unknown> = { status: "running" };
  if (privateIp) patch.private_ip = privateIp;
  // Same column AWS DescribeInstances already fills. Azure callers pass the
  // Standard PIP address from the NIC. Empty must not clear a value written
  // at provision time.
  if (publicIp) patch.public_ip = publicIp;
  const { error } = await supabase.from("virtual_machines").update(patch).eq("id", vmId);
  if (error) {
    console.error(`azure-reconcile: promote ${vmId} failed:`, error.message);
    return false;
  }
  return true;
}
