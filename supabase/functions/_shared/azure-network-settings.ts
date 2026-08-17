// Admin-configurable defaults used when provisioning has to create the lab
// network automatically (Admin → Settings → Network).
//
// Stored in public.platform_settings under the key `azure_network_defaults`.

export interface AzureNetworkDefaults {
  /** Resource group used for auto-created networking (overrides the provider account value when set). */
  resourceGroup: string | null;
  vnetName: string;
  vnetCidr: string;
  subnetName: string;
  subnetCidr: string;
  /** Optional post-provisioning SSH/RDP reachability probe. */
  connectivityCheckEnabled: boolean;
  connectivityCheckTimeoutMs: number;
}

export const SETTINGS_KEY = "azure_network_defaults";

export const DEFAULT_AZURE_NETWORK: AzureNetworkDefaults = {
  resourceGroup: null,
  vnetName: "skilllabs-vnet",
  vnetCidr: "10.30.0.0/16",
  subnetName: "default",
  subnetCidr: "10.30.1.0/24",
  connectivityCheckEnabled: false,
  connectivityCheckTimeoutMs: 5000,
};

const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function normalizeNetworkDefaults(value: unknown): AzureNetworkDefaults {
  const v = (value ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const pick = (raw: string, fallback: string, re: RegExp) => (re.test(raw) ? raw : fallback);

  const rg = str(v.resource_group);
  const timeout = Number(v.connectivity_check_timeout_ms);

  return {
    resourceGroup: NAME.test(rg) ? rg : null,
    vnetName: pick(str(v.vnet_name), DEFAULT_AZURE_NETWORK.vnetName, NAME),
    vnetCidr: pick(str(v.vnet_cidr), DEFAULT_AZURE_NETWORK.vnetCidr, CIDR),
    subnetName: pick(str(v.subnet_name), DEFAULT_AZURE_NETWORK.subnetName, NAME),
    subnetCidr: pick(str(v.subnet_cidr), DEFAULT_AZURE_NETWORK.subnetCidr, CIDR),
    connectivityCheckEnabled: v.connectivity_check_enabled === true,
    connectivityCheckTimeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 30000
      ? Math.round(timeout)
      : DEFAULT_AZURE_NETWORK.connectivityCheckTimeoutMs,
  };
}

/** Read the platform network defaults; falls back to the built-in values. */
export async function loadAzureNetworkDefaults(
  // deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
  admin: any,
): Promise<AzureNetworkDefaults> {
  try {
    const { data } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    return normalizeNetworkDefaults(data?.value);
  } catch {
    return { ...DEFAULT_AZURE_NETWORK };
  }
}
