// Maps raw provisioning errors (mostly Azure/resource-provider config issues)
// to the specific Admin → Resource Providers field that must be fixed.

export interface ProvisioningErrorHint {
  title: string;
  detail: string;
  /** Admin form fields the operator has to complete. */
  fields: { key: string; label: string }[];
  steps: string[];
  /** Where the fix lives, when an admin route can be linked. */
  adminPath?: string;
  adminLabel?: string;
}

const FIELD_LABELS: Record<string, string> = {
  subnet_id: "Subnet ID (fully qualified ARM resource id)",
  vm_admin_password: "VM Admin Password",
  vm_admin_username: "VM Admin Username",
  key_vault_uri: "Key Vault URI",
  subscription_id: "Subscription ID",
  tenant_id: "Directory (tenant) ID",
  client_id: "Application (client) ID",
  client_secret: "Client Secret Value",
  resource_group: "Resource Group",
};

const PATTERNS: { test: RegExp; field: string }[] = [
  { test: /subnet/i, field: "subnet_id" },
  { test: /vm admin password|admin password/i, field: "vm_admin_password" },
  { test: /key vault/i, field: "key_vault_uri" },
  { test: /subscription id|SubscriptionNotFound/i, field: "subscription_id" },
  { test: /tenant/i, field: "tenant_id" },
  { test: /client secret|invalid_client/i, field: "client_secret" },
  { test: /application \(client\) id|client id/i, field: "client_id" },
  { test: /resource group/i, field: "resource_group" },
];

/** Pull structured hints out of an edge-function error payload or message. */
export function parseProvisioningError(
  message: string,
  payload?: { missing_fields?: string[]; setting?: string; suggestion?: string } | null,
): ProvisioningErrorHint {
  const raw = message || "Provisioning failed";
  const keys = new Set<string>(payload?.missing_fields ?? []);
  if (!keys.size) {
    for (const p of PATTERNS) if (p.test.test(raw)) keys.add(p.field);
  }

  const fields = [...keys].map((key) => ({ key, label: FIELD_LABELS[key] ?? key }));

  if (fields.length) {
    return {
      title: "Cloud account is not fully configured",
      detail: raw,
      fields,
      steps: [
        "Open Admin → Resource Providers and edit the Azure account used by this lab.",
        `Complete: ${fields.map((f) => f.label).join(", ")}.`,
        "Use “Test connection”, save, then launch the lab again.",
      ],
      adminPath: "/admin/resource-providers",
      adminLabel: payload?.setting ?? "Resource Providers",
    };
  }

  if (/quota|QuotaExceeded/i.test(raw)) {
    return {
      title: "Azure quota exhausted",
      detail: raw,
      fields: [],
      steps: [
        "Terminate idle lab VMs to free cores, or",
        "Request a quota increase for the VM family in this region.",
      ],
    };
  }

  return {
    title: "Launch failed",
    detail: raw,
    fields: [],
    steps: ["Retry the launch. If it keeps failing, share the correlation id with an administrator."],
  };
}
