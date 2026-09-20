// Groups failed provisioning events into actionable error classes so admins can
// jump straight to the exact setting that caused the failure.

export interface ProvisioningFailureEvent {
  id: string;
  created_at: string;
  correlation_id: string;
  step: string;
  status: string;
  message: string | null;
  vm_id?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface ErrorClass {
  /** Stable key used for grouping and alert de-duplication. */
  key: string;
  title: string;
  /** Human description of the root cause. */
  cause: string;
  /** Where the fix lives. */
  settingLabel: string;
  adminPath: string;
  fixSteps: string[];
  /** Alert when this class occurs at least this many times in the window. */
  alertThreshold: number;
}

export const UNKNOWN_ERROR_CLASS: ErrorClass = {
  key: "unknown",
  title: "Unclassified provisioning failure",
  cause: "The provisioning step failed with an error the platform does not recognise yet.",
  settingLabel: "Provisioning Status log",
  adminPath: "/admin/provisioning-status",
  fixSteps: ["Open the full provisioning log for this attempt and inspect the failing step."],
  alertThreshold: 3,
};

const NETWORK_SETTINGS_PATH = "/settings?tab=network";
const PROVIDERS_PATH = "/admin/resource-providers";

const CLASSES: { test: RegExp; value: ErrorClass }[] = [
  {
    test: /InvalidResourceReference|resource (?:navigation link|reference) .*not (?:be )?found|referenced resource.*was not found/i,
    value: {
      key: "invalid_resource_reference",
      title: "Network interface references a subnet that does not exist",
      cause:
        "Azure rejected the NIC because the configured subnet / VNet ARM id cannot be resolved in the "
        + "subscription (usually a wrong resource group, a renamed VNet, or a subnet in another region).",
      settingLabel: "Settings → Network → VNet / Subnet",
      adminPath: NETWORK_SETTINGS_PATH,
      fixSteps: [
        "Open Settings → Network and run \"Validate Azure Network Settings\".",
        "Correct the Resource Group / VNet name / Subnet name so they match a real network in the subscription.",
        "Alternatively clear the Subnet ID on the resource provider so the managed lab network is created automatically.",
      ],
      alertThreshold: 1,
    },
  },
  {
    test: /subnet .*(?:region|location) mismatch|different region than the VM|NetworkInterfaceLocationMismatch|region mismatch/i,
    value: {
      key: "subnet_region_mismatch",
      title: "Subnet is in a different region than the lab VM",
      cause: "A NIC can only attach to a subnet whose VNet lives in the same Azure region as the VM.",
      settingLabel: "Settings → Network → VNet region",
      adminPath: NETWORK_SETTINGS_PATH,
      fixSteps: [
        "Pick a VNet/subnet in the same region as the lab template's default region, or",
        "Change the resource provider's default region to the VNet's region.",
      ],
      alertThreshold: 1,
    },
  },
  {
    test: /ResourceGroupNotFound|resource group .*(?:does not exist|not found)/i,
    value: {
      key: "resource_group_not_found",
      title: "Resource group does not exist",
      cause: "The configured resource group is missing from the subscription used for provisioning.",
      settingLabel: "Settings → Network → Resource Group",
      adminPath: NETWORK_SETTINGS_PATH,
      fixSteps: ["Create the resource group in Azure, or set an existing one in Settings → Network."],
      alertThreshold: 1,
    },
  },
  {
    test: /SubscriptionNotFound|DisabledSubscription|ReadOnlyDisabledSubscription/i,
    value: {
      key: "subscription_unavailable",
      title: "Azure subscription is missing or disabled",
      cause: "The subscription linked to the resource provider is not usable for writes.",
      settingLabel: "Resource Providers → Subscription ID",
      adminPath: PROVIDERS_PATH,
      fixSteps: ["Re-enable the subscription in Azure or point the resource provider at an active subscription."],
      alertThreshold: 1,
    },
  },
  {
    test: /AuthorizationFailed|does not have authorization|AADSTS|invalid_client|Azure auth failed/i,
    value: {
      key: "credentials_or_rbac",
      title: "Service principal credentials or RBAC are invalid",
      cause: "Azure refused the service principal sign-in or the requested write operation.",
      settingLabel: "Resource Providers → Client Secret / role assignment",
      adminPath: PROVIDERS_PATH,
      fixSteps: [
        "Re-enter the client secret value (not the secret id) on the resource provider.",
        "Assign the Contributor role on the subscription or resource group.",
      ],
      alertThreshold: 1,
    },
  },
  {
    test: /QuotaExceeded|Operation could not be completed as it results in exceeding|core quota/i,
    value: {
      key: "quota_exceeded",
      title: "Azure quota exhausted",
      cause: "The subscription has no remaining vCPU quota in the target region for this VM size.",
      settingLabel: "Regions & quota",
      adminPath: "/regions",
      fixSteps: ["Request a quota increase, use a smaller VM size, or provision in another region."],
      alertThreshold: 2,
    },
  },
  {
    test: /SkuNotAvailable|not available in (?:location|region)|AllocationFailed/i,
    value: {
      key: "capacity_unavailable",
      title: "VM size unavailable in the target region",
      cause: "Azure has no capacity for the requested SKU in this region.",
      settingLabel: "Lab template → VM size",
      adminPath: "/labs",
      fixSteps: ["Select a widely available VM size or switch the template's region."],
      alertThreshold: 2,
    },
  },
  {
    test: /deny-all|route table|NSG|connectivity requirements/i,
    value: {
      key: "subnet_policy",
      title: "Subnet policy blocks lab connectivity",
      cause: "A deny-all NSG rule or a blackholed default route would make the lab VM unreachable.",
      settingLabel: "Settings → Network → Subnet",
      adminPath: NETWORK_SETTINGS_PATH,
      fixSteps: ["Allow inbound 22/3389 from the gateway and remove the blackhole route on the subnet."],
      alertThreshold: 1,
    },
  },
];

/** Classify one failure message (plus optional structured code) into an error class. */
export function classifyProvisioningFailure(
  message: string | null | undefined,
  detail?: Record<string, unknown> | null,
): ErrorClass {
  const code = typeof detail?.code === "string" ? detail.code : "";
  const haystack = `${code} ${message ?? ""}`.trim();
  if (!haystack) return UNKNOWN_ERROR_CLASS;
  return CLASSES.find((c) => c.test.test(haystack))?.value ?? UNKNOWN_ERROR_CLASS;
}

export interface ErrorGroup {
  errorClass: ErrorClass;
  count: number;
  firstSeen: string;
  lastSeen: string;
  correlationIds: string[];
  /** Distinct raw messages, newest first, capped for display. */
  samples: { message: string; at: string; correlationId: string; step: string }[];
  /** True when the count in the window crossed the class alert threshold. */
  alerting: boolean;
}

/** Build the breakdown of failure classes from raw failed provisioning events. */
export function buildErrorBreakdown(events: ProvisioningFailureEvent[]): ErrorGroup[] {
  const failures = events.filter((e) => e.status === "failed");
  const groups = new Map<string, ErrorGroup>();

  for (const event of failures) {
    const errorClass = classifyProvisioningFailure(event.message, event.detail);
    const existing = groups.get(errorClass.key);
    const at = event.created_at;
    if (!existing) {
      groups.set(errorClass.key, {
        errorClass,
        count: 1,
        firstSeen: at,
        lastSeen: at,
        correlationIds: [event.correlation_id],
        samples: [{ message: event.message ?? "", at, correlationId: event.correlation_id, step: event.step }],
        alerting: 1 >= errorClass.alertThreshold,
      });
      continue;
    }
    existing.count += 1;
    if (at < existing.firstSeen) existing.firstSeen = at;
    if (at > existing.lastSeen) existing.lastSeen = at;
    if (!existing.correlationIds.includes(event.correlation_id)) existing.correlationIds.push(event.correlation_id);
    if (existing.samples.length < 5 && !existing.samples.some((s) => s.message === (event.message ?? ""))) {
      existing.samples.push({ message: event.message ?? "", at, correlationId: event.correlation_id, step: event.step });
    }
    existing.alerting = existing.count >= errorClass.alertThreshold;
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
}

export interface BreakdownAlert {
  key: string;
  title: string;
  severity: "critical" | "warning";
  message: string;
  adminPath: string;
  settingLabel: string;
}

/** Alerts for the error classes that crossed their threshold in the window. */
export function breakdownAlerts(groups: ErrorGroup[], windowLabel = "the selected window"): BreakdownAlert[] {
  return groups
    .filter((g) => g.alerting && g.errorClass.key !== UNKNOWN_ERROR_CLASS.key)
    .map((g) => ({
      key: g.errorClass.key,
      title: g.errorClass.title,
      severity: g.count >= 3 ? ("critical" as const) : ("warning" as const),
      message:
        `${g.count} provisioning failure${g.count === 1 ? "" : "s"} in ${windowLabel} — ${g.errorClass.cause} `
        + `Fix in ${g.errorClass.settingLabel}.`,
      adminPath: g.errorClass.adminPath,
      settingLabel: g.errorClass.settingLabel,
    }));
}
