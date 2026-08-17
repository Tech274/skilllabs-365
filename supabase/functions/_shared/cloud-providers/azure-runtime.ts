// Azure runtime configuration resolved from the Resource Providers registry.
//
// The legacy AZURE_* environment configuration is gone: every Azure operation
// (VM provisioning, status polling, cleanup, quota, reporting) must resolve its
// subscription and service principal from public.cloud_provider_accounts.
import { resolveAccount, type ProviderAccount } from "./accounts.ts";

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
export function assertVmProvisioningReady(runtime: AzureRuntime): void {
  const missing: string[] = [];
  if (!runtime.subnetId) missing.push("Subnet ID (fully qualified ARM resource id)");
  if (!runtime.adminPassword) missing.push("VM admin password");
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
