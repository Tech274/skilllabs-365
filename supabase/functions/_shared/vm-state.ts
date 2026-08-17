// Canonical VM lifecycle state machine and Azure → DB status mapping.
//
// DB enum public.vm_status:
//   provisioning -> Azure create issued, VM not yet running
//   starting     -> reserved (manual start)
//   running      -> Azure PowerState/running, reachable
//   idle         -> running but no session activity (set by cleanup)
//   expired      -> session duration elapsed
//   stopped      -> user-initiated stop, VM kept allocated
//   deallocated  -> Azure VM kept but compute released
//   terminated   -> Azure VM deleted (permanent)
//   failed       -> provisioning or Azure operation failed
//
// Terminal states (no further transitions): terminated, failed, expired.
// Polling should stop when status ∈ terminal ∪ {running, deallocated, stopped}.

export type VmStatus =
  | "provisioning" | "starting" | "running" | "idle" | "expired"
  | "stopped" | "deallocated" | "terminated" | "failed";

export const TERMINAL_VM_STATUSES: VmStatus[] = ["terminated", "failed", "expired"];

export function isTerminal(s: VmStatus | string | null | undefined): boolean {
  return !!s && (TERMINAL_VM_STATUSES as string[]).includes(s);
}

/** Map Azure VM instanceView statuses → DB vm_status, or null if unchanged. */
export function azureStatusToVmStatus(
  statuses: Array<{ code?: string; level?: string }> | undefined
): VmStatus | null {
  if (!statuses || !statuses.length) return null;
  const codes = statuses.map((s) => s.code || "").filter(Boolean);

  // Provisioning failures are terminal.
  if (codes.some((c) => c === "ProvisioningState/failed" || c.startsWith("ProvisioningState/failed/"))) {
    return "failed";
  }
  const power = codes.find((c) => c.startsWith("PowerState/"));
  if (power === "PowerState/running") return "running";
  if (power === "PowerState/stopped") return "stopped";
  if (power === "PowerState/deallocated") return "deallocated";
  if (power === "PowerState/stopping" || power === "PowerState/deallocating") return null;

  // Still provisioning.
  if (codes.some((c) => c === "ProvisioningState/creating" || c === "ProvisioningState/updating")) {
    return "provisioning";
  }
  return null;
}

/** Translate raw Azure / provisioning errors into user-friendly messages. */
export function mapAzureError(raw: string): string {
  const m = raw || "";
  if (/exceeding approved.*Cores quota|QuotaExceeded|OperationNotAllowed.*quota/i.test(m)) {
    return "Azure VM quota exceeded. All available compute cores are in use. Please stop or delete unused VMs, or ask an administrator to increase the quota.";
  }
  if (/SkuNotAvailable|NotAvailableForSubscription/i.test(m)) {
    return "The selected VM size is not available in this region for your subscription. Try a different region or VM size.";
  }
  if (/AllocationFailed|ZonalAllocationFailed|OverconstrainedAllocationRequest/i.test(m)) {
    return "Azure could not allocate capacity for this VM right now. Please retry in a few minutes or choose a different region.";
  }
  if (/InvalidParameter|InvalidTemplateDeployment|BadRequest/i.test(m)) {
    return "The lab template has an invalid Azure configuration. An administrator should review the VM size, image, and region.";
  }
  if (/AuthorizationFailed|Forbidden|insufficient privileges/i.test(m)) {
    return "Azure rejected the request due to insufficient permissions. Please contact your administrator.";
  }
  if (/SubscriptionNotFound|SubscriptionDoesNotHaveServer|DisabledSubscription/i.test(m)) {
    return "The configured Azure subscription could not be found or is disabled. An administrator must verify AZURE_SUBSCRIPTION_ID (and that the service principal has access to it).";
  }
  if (/ResourceGroupNotFound/i.test(m)) {
    return "The configured Azure resource group does not exist. An administrator must verify AZURE_RESOURCE_GROUP.";
  }
  if (/MissingSubscriptionRegistration|SubscriptionNotRegistered/i.test(m)) {
    return "The Azure subscription is not registered for the required resource providers (Microsoft.Compute / Microsoft.Network). An administrator must register them.";
  }
  if (/Azure auth failed|AADSTS|invalid_client/i.test(m)) {
    return "Azure authentication failed. Please contact your administrator.";
  }

  if (/SubnetIsFull|PrivateIPAddressIsAlreadyUsed|NetworkingInternalOperationError/i.test(m)) {
    return "The lab network is at capacity. Please ask an administrator to free addresses or expand the subnet.";
  }
  if (/OperationNotAllowed/i.test(m)) {
    return "This operation is not currently allowed by Azure. Please try again later or contact your administrator.";
  }
  return "Lab provisioning failed. Please try again, or contact your administrator if the issue persists.";
}
