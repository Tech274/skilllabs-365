// Azure public IP allocation + NIC association helpers.
//
// AWS RunInstances sets AssociatePublicIpAddress and check-vm-status writes
// DescribeInstances public IP into virtual_machines.public_ip when the row
// flips to running. Azure create used a private NIC only, so Hub public_ip
// stayed null after PowerState/running (SCRUM-43). These helpers build the
// Standard static PIP + NIC association and parse the address back out.

const ARM_HOST = "https://management.azure.com";
export const AZURE_NETWORK_API = "2024-03-01";

export function azureNicName(vmName: string): string {
  return `${vmName}-nic`;
}

export function azurePublicIpName(vmName: string): string {
  return `${vmName}-pip`;
}

export function azurePublicIpResourceId(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/publicIPAddresses/${
    azurePublicIpName(vmName)
  }`;
}

export function armResourceUrl(
  resourceId: string,
  apiVersion = AZURE_NETWORK_API,
): string {
  const id = resourceId.startsWith("/") ? resourceId : `/${resourceId}`;
  const sep = id.includes("?") ? "&" : "?";
  return `${ARM_HOST}${id}${sep}api-version=${apiVersion}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

/** IPv4 on a publicIPAddresses resource (`properties.ipAddress`). */
export function readArmIpAddress(resource: unknown): string | null {
  const addr = asRecord(asRecord(resource)?.properties)?.ipAddress;
  if (typeof addr !== "string") return null;
  const trimmed = addr.trim();
  return trimmed || null;
}

function ipConfigurations(nic: unknown): unknown[] {
  const configs = asRecord(asRecord(nic)?.properties)?.ipConfigurations;
  return Array.isArray(configs) ? configs : [];
}

export function readNicPrivateIp(nic: unknown): string | null {
  for (const cfg of ipConfigurations(nic)) {
    const ip = asRecord(asRecord(cfg)?.properties)?.privateIPAddress;
    if (typeof ip !== "string") continue;
    const trimmed = ip.trim();
    if (trimmed && trimmed.toLowerCase() !== "pending") return trimmed;
  }
  return null;
}

export interface NicPublicIpRef {
  /** ARM id of the associated publicIPAddresses resource, when present. */
  resourceId: string | null;
  /** Inline address when Azure expanded it on the NIC; otherwise null. */
  address: string | null;
}

/** Public IP reference on the first NIC ipConfiguration that has one. */
export function readNicPublicIpRef(nic: unknown): NicPublicIpRef {
  for (const cfg of ipConfigurations(nic)) {
    const pip = asRecord(asRecord(cfg)?.properties)?.publicIPAddress;
    if (!pip) continue;
    const id = asRecord(pip)?.id;
    const resourceId = typeof id === "string" && id.trim() ? id.trim() : null;
    return { resourceId, address: readArmIpAddress(pip) };
  }
  return { resourceId: null, address: null };
}

/**
 * Standard static regional PIP. Static so the address exists before the VM
 * reaches Running and survives deallocate/start (unlike a Basic dynamic IP).
 */
export function buildAzurePublicIpBody(
  region: string,
): Record<string, unknown> {
  return {
    location: region,
    sku: { name: "Standard" },
    properties: {
      publicIPAllocationMethod: "Static",
      publicIPAddressVersion: "IPv4",
    },
    tags: { managedBy: "skilllabs", purpose: "lab-vm" },
  };
}

/**
 * NIC with a dynamic private IP plus the lab PIP.
 * deleteOption=Delete drops the PIP when the NIC is removed with the VM.
 */
export function buildAzureNicBody(opts: {
  region: string;
  subnetId: string;
  publicIpId: string;
}): Record<string, unknown> {
  return {
    location: opts.region,
    properties: {
      ipConfigurations: [
        {
          name: "ipconfig1",
          properties: {
            subnet: { id: opts.subnetId },
            privateIPAllocationMethod: "Dynamic",
            publicIPAddress: {
              id: opts.publicIpId,
              properties: { deleteOption: "Delete" },
            },
          },
        },
      ],
    },
    tags: { managedBy: "skilllabs", purpose: "lab-vm" },
  };
}
