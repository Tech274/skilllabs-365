// Azure runtime configuration resolved from the Resource Providers registry.
//
// The legacy AZURE_* environment configuration is gone: every Azure operation
// (VM provisioning, status polling, cleanup, quota, reporting) must resolve its
// subscription and service principal from public.cloud_provider_accounts.
import { resolveAccount, type ProviderAccount } from "./accounts.ts";
import { DEFAULT_AZURE_NETWORK, type AzureNetworkDefaults } from "../azure-network-settings.ts";

export interface AzureRuntime {
  accountId: string;
  displayName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  resourceGroup: string;
  subnetId: string;
  adminUsername: string;
  adminPassword: string;
  /** How the lab VM admin credential is obtained. */
  authMode: "password" | "key_vault" | "managed_identity";
  keyVaultUri: string;
  keyVaultSecretName: string;
  /** Optional user-assigned managed identity resource id to attach to lab VMs. */
  managedIdentityId: string;
  defaultRegion: string | null;
}

export class ProviderConfigError extends Error {
  readonly setting: string;
  readonly suggestion: string;
  readonly code = "ResourceProviderNotConfigured";
  constructor(message: string, setting: string, suggestion: string) {
    super(message);
    this.name = "ProviderConfigError";
    this.setting = setting;
    this.suggestion = suggestion;
  }
}

const ADMIN_HINT = "Open Admin → Resource Providers and complete this Azure account.";

/** Validate a registry account row and turn it into a usable Azure runtime. */
export function azureRuntimeFromAccount(account: ProviderAccount): AzureRuntime {
  const creds = (account.credentials ?? {}) as Record<string, string>;
  const cfg = (account.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const runtime: AzureRuntime = {
    accountId: account.id,
    displayName: account.display_name,
    tenantId: str(creds.tenant_id),
    clientId: str(creds.client_id),
    clientSecret: str(creds.client_secret),
    subscriptionId: str(cfg.subscription_id),
    resourceGroup: str(cfg.resource_group) || "skilllabs-rg",
    subnetId: str(cfg.subnet_id),
    adminUsername: str(cfg.vm_admin_username) || "labadmin",
    adminPassword: str(creds.vm_admin_password),
    authMode: (["password", "key_vault", "managed_identity"].includes(str(cfg.vm_auth_mode))
      ? str(cfg.vm_auth_mode)
      : "password") as AzureRuntime["authMode"],
    keyVaultUri: str(cfg.key_vault_uri).replace(/\/$/, ""),
    keyVaultSecretName: str(cfg.key_vault_secret_name) || "lab-vm-admin-password",
    managedIdentityId: str(cfg.managed_identity_id),
    defaultRegion: account.default_region ?? null,
  };

  const missing: string[] = [];
  if (!runtime.tenantId) missing.push("Directory (tenant) ID");
  if (!runtime.clientId) missing.push("Application (client) ID");
  if (!runtime.clientSecret) missing.push("Client Secret Value");
  if (!runtime.subscriptionId) missing.push("Subscription ID");
  if (missing.length) {
    throw new ProviderConfigError(
      `Resource provider "${account.display_name}" is incomplete: ${missing.join(", ")} missing.`,
      `Resource Providers → ${account.display_name}`,
      ADMIN_HINT,
    );
  }
  return runtime;
}

/** Extra requirements that only VM provisioning needs. */
export function vmProvisioningGaps(runtime: AzureRuntime): { field: string; label: string }[] {
  const gaps: { field: string; label: string }[] = [];
  if (!runtime.subnetId) gaps.push({ field: "subnet_id", label: "Subnet ID (fully qualified ARM resource id)" });
  if (runtime.authMode === "password" && !runtime.adminPassword) {
    gaps.push({ field: "vm_admin_password", label: "VM admin password" });
  }
  if (runtime.authMode === "key_vault" && !runtime.keyVaultUri) {
    gaps.push({ field: "key_vault_uri", label: "Key Vault URI" });
  }
  return gaps;
}

export function assertVmProvisioningReady(runtime: AzureRuntime): void {
  const missing = vmProvisioningGaps(runtime).map((g) => g.label);
  if (missing.length) {
    throw new ProviderConfigError(
      `Resource provider "${runtime.displayName}" cannot provision lab VMs: ${missing.join(", ")} missing.`,
      `Resource Providers → ${runtime.displayName}`,
      ADMIN_HINT,
    );
  }
}

/**
 * Resolve the Azure runtime for an explicit account id, falling back to the
 * default active Azure account. Throws a ProviderConfigError when nothing is
 * registered — provisioning must never silently pick up ambient credentials.
 */
export async function resolveAzureRuntime(
  // deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
  admin: any,
  accountId?: string | null,
): Promise<AzureRuntime> {
  const account = await resolveAccount(admin, "azure", accountId ?? null);
  if (!account) {
    throw new ProviderConfigError(
      "No active Azure resource provider is registered.",
      "Resource Providers",
      "Add an Azure subscription under Admin → Resource Providers and mark it active (or set it as default).",
    );
  }
  return azureRuntimeFromAccount(account);
}

/** Same as resolveAzureRuntime but returns null instead of throwing. */
export async function tryResolveAzureRuntime(
  // deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
  admin: any,
  accountId?: string | null,
): Promise<AzureRuntime | null> {
  try {
    return await resolveAzureRuntime(admin, accountId);
  } catch {
    return null;
  }
}

const NET_API = "2023-09-01";

async function armToken(runtime: AzureRuntime): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${runtime.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: runtime.clientId,
      client_secret: runtime.clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure auth failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token as string;
}

/**
 * Resolve a usable subnet for lab VMs when the provider record has none:
 * reuse an existing VNet in the target region, otherwise create a dedicated
 * lab VNet. The discovered id is persisted back onto the provider account so
 * later provisions skip the lookup.
 */
export async function ensureAzureSubnet(
  // deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
  admin: any,
  runtime: AzureRuntime,
  region: string,
  networkDefaults: AzureNetworkDefaults = DEFAULT_AZURE_NETWORK,
): Promise<{ subnetId: string; created: boolean; source: "configured" | "discovered" | "created" }> {
  if (runtime.subnetId) return { subnetId: runtime.subnetId, created: false, source: "configured" };

  const token = await armToken(runtime);
  const auth = { authorization: `Bearer ${token}` };
  const sub = runtime.subscriptionId;

  // 1. Look for an existing VNet with a subnet (prefer the target region).
  const listRes = await fetch(
    `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.Network/virtualNetworks?api-version=${NET_API}`,
    { headers: auth },
  );
  let subnetId = "";
  if (listRes.ok) {
    const vnets = (await listRes.json()).value ?? [];
    const withSubnets = vnets.filter((v: any) => (v.properties?.subnets ?? []).length > 0);
    const preferred = withSubnets.find((v: any) => v.location === region) ?? withSubnets[0];
    if (preferred) subnetId = preferred.properties.subnets[0].id;
  }

  let created = false;

  // 2. Nothing usable — create a dedicated lab VNet in the configured resource group.
  if (!subnetId) {
    created = true;
    const rg = networkDefaults.resourceGroup || runtime.resourceGroup;
    await fetch(
      `https://management.azure.com/subscriptions/${sub}/resourcegroups/${rg}?api-version=2021-04-01`,
      { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ location: region }) },
    );
    const vnetName = networkDefaults.vnetName;
    const createRes = await fetch(
      `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=${NET_API}`,
      {
        method: "PUT",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          location: region,
          properties: {
            addressSpace: { addressPrefixes: [networkDefaults.vnetCidr] },
            subnets: [{ name: networkDefaults.subnetName, properties: { addressPrefix: networkDefaults.subnetCidr } }],
          },
        }),
      },
    );
    if (!createRes.ok) {
      throw new ProviderConfigError(
        `Resource provider "${runtime.displayName}" has no Subnet ID and automatic network setup failed: ${(await createRes.text()).slice(0, 300)}`,
        `Resource Providers → ${runtime.displayName}`,
        ADMIN_HINT,
      );
    }
    subnetId = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${networkDefaults.subnetName}`;
  }

  // 3. Persist so future provisions reuse it.
  try {
    const { data: row } = await admin
      .from("cloud_provider_accounts").select("config").eq("id", runtime.accountId).maybeSingle();
    await admin
      .from("cloud_provider_accounts")
      .update({ config: { ...(row?.config ?? {}), subnet_id: subnetId } })
      .eq("id", runtime.accountId);
  } catch { /* non-fatal: provisioning can continue with the resolved id */ }

  runtime.subnetId = subnetId;
  return { subnetId, created, source: created ? "created" : "discovered" };
}

/** List VNets and their subnets for an Azure account (admin subnet picker). */
export async function listAzureNetworks(runtime: AzureRuntime): Promise<{
  vnets: { id: string; name: string; location: string; addressPrefixes: string[];
           subnets: { id: string; name: string; addressPrefix: string | null }[] }[];
}> {
  const token = await armToken(runtime);
  const res = await fetch(
    `https://management.azure.com/subscriptions/${runtime.subscriptionId}/providers/Microsoft.Network/virtualNetworks?api-version=${NET_API}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Failed to list virtual networks (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const value = (await res.json()).value ?? [];
  return {
    // deno-lint-ignore no-explicit-any -- ARM response shape
    vnets: value.map((v: any) => ({
      id: v.id,
      name: v.name,
      location: v.location,
      addressPrefixes: v.properties?.addressSpace?.addressPrefixes ?? [],
      // deno-lint-ignore no-explicit-any -- ARM response shape
      subnets: (v.properties?.subnets ?? []).map((s: any) => ({
        id: s.id, name: s.name, addressPrefix: s.properties?.addressPrefix ?? null,
      })),
    })),
  };
}

/** Random, compliant Azure VM admin password (used for managed-identity mode). */
export function generateVmPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^*_-+="];
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = sets.map((s, i) => s[bytes[i] % s.length]);
  for (let i = 4; i < 20; i++) {
    const set = sets[bytes[i] % sets.length];
    chars.push(set[bytes[i] % set.length]);
  }
  return chars.join("");
}

/** Fetch the VM admin password from Azure Key Vault (key_vault auth mode). */
export async function fetchKeyVaultSecret(runtime: AzureRuntime, secretName?: string): Promise<string> {
  const name = secretName || runtime.keyVaultSecretName;
  const res = await fetch(`https://login.microsoftonline.com/${runtime.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: runtime.clientId,
      client_secret: runtime.clientSecret,
      scope: "https://vault.azure.net/.default",
    }),
  });
  if (!res.ok) throw new Error(`Key Vault auth failed [${res.status}]`);
  const token = (await res.json()).access_token as string;
  const secRes = await fetch(`${runtime.keyVaultUri}/secrets/${name}?api-version=7.4`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!secRes.ok) {
    throw new ProviderConfigError(
      `Key Vault secret "${name}" could not be read (${secRes.status}). Grant the service principal "get" access on secrets.`,
      `Resource Providers → ${runtime.displayName}`,
      ADMIN_HINT,
    );
  }
  return String((await secRes.json()).value ?? "");
}

/**
 * Resolve the admin password to use for a lab VM according to the account's
 * auth mode. Managed identity still needs a bootstrap admin credential in the
 * Azure API, so we generate an ephemeral one that is never stored or returned.
 */
export async function resolveVmAdminPassword(runtime: AzureRuntime): Promise<string> {
  if (runtime.authMode === "key_vault") return await fetchKeyVaultSecret(runtime);
  if (runtime.authMode === "managed_identity") return generateVmPassword();
  return runtime.adminPassword;
}
