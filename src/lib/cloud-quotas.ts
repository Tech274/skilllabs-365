/**
 * Admin Cloud Quotas helpers — capacity math + region catalogue.
 *
 * SKU needs: derived from published lab_templates.vm_size when available.
 * Fallback assumption constants documented below (Hub default lab SKU).
 */

export type QuotaProvider = "azure" | "aws";

export type QuotaMetric = {
  name: string;
  key: string;
  currentUsage: number;
  limit: number;
  unit: string;
};

export type RegionQuotaRow = {
  region: string;
  displayName: string;
  isHome: boolean;
  metrics: QuotaMetric[];
  /** How many lab VMs fit given SKU needs vs remaining capacity. */
  labsFit: number;
  limitingFactor: string | null;
  syncOk: boolean;
  syncError?: string | null;
};

export type SkuNeeds = {
  vmSize: string;
  vcpus: number;
  familyKey: string;
  familyLabel: string;
  source: "lab_templates" | "assumption";
  sampleCount: number;
};

/** Hub default when no published lab_templates exist. */
export const ASSUMED_LAB_SKU = {
  vmSize: "Standard_B2s",
  vcpus: 2,
  familyKey: "standardBSFamily",
  familyLabel: "Standard BS Family vCPUs",
} as const;

/** Azure home / default region for capacity center (NOT southindia). */
export const AZURE_HOME_REGION = "centralindia";

/** AWS home region for capacity center (Mumbai — India). */
export const AWS_HOME_REGION = "ap-south-1";

export const AZURE_REGION_LABELS: Record<string, string> = {
  centralindia: "Central India",
  southindia: "South India",
  westindia: "West India",
  eastus: "East US",
  eastus2: "East US 2",
  westus2: "West US 2",
  westus3: "West US 3",
  centralus: "Central US",
  northeurope: "North Europe",
  westeurope: "West Europe",
  uksouth: "UK South",
  southeastasia: "Southeast Asia",
  japaneast: "Japan East",
  australiaeast: "Australia East",
  canadacentral: "Canada Central",
  uaenorth: "UAE North",
};

/** Curated bankable Azure regions for sync (home first). */
export const AZURE_BANKABLE_REGIONS = [
  "centralindia",
  "eastus",
  "southeastasia",
  "northeurope",
  "uksouth",
  "westus2",
  "westeurope",
  "japaneast",
  "australiaeast",
  "southindia",
] as const;

export const AWS_REGION_LABELS: Record<string, string> = {
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "eu-west-1": "Europe (Ireland)",
  "eu-central-1": "Europe (Frankfurt)",
  "us-east-1": "US East (N. Virginia)",
  "us-west-2": "US West (Oregon)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
};

export const AWS_BANKABLE_REGIONS = [
  "ap-south-1",
  "ap-southeast-1",
  "us-east-1",
  "eu-west-1",
  "us-west-2",
  "ap-northeast-1",
  "eu-central-1",
  "ap-southeast-2",
] as const;

/** Map Azure VM size → vCPU + compute family usage key. */
export const AZURE_VM_SIZE_META: Record<string, { vcpus: number; familyKey: string; familyLabel: string }> = {
  Standard_B1s: { vcpus: 1, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B1ms: { vcpus: 1, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B2s: { vcpus: 2, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B2ms: { vcpus: 2, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B4ms: { vcpus: 4, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_D2s_v3: { vcpus: 2, familyKey: "standardDSv3Family", familyLabel: "Standard DSv3 Family vCPUs" },
  Standard_D4s_v3: { vcpus: 4, familyKey: "standardDSv3Family", familyLabel: "Standard DSv3 Family vCPUs" },
  Standard_D2as_v5: { vcpus: 2, familyKey: "standardDASv5Family", familyLabel: "Standard DASv5 Family vCPUs" },
  Standard_D4as_v5: { vcpus: 4, familyKey: "standardDASv5Family", familyLabel: "Standard DASv5 Family vCPUs" },
  Standard_E2s_v3: { vcpus: 2, familyKey: "standardESv3Family", familyLabel: "Standard ESv3 Family vCPUs" },
  Standard_F2s_v2: { vcpus: 2, familyKey: "standardFSv2Family", familyLabel: "Standard FSv2 Family vCPUs" },
};

export function remaining(metric: QuotaMetric | undefined): number {
  if (!metric || metric.limit <= 0) return 0;
  return Math.max(0, metric.limit - metric.currentUsage);
}

export function findMetric(metrics: QuotaMetric[], key: string): QuotaMetric | undefined {
  return metrics.find((m) => m.key === key);
}

/**
 * Labs that fit = min of remaining family vCPU / sku vCPU,
 * remaining total cores / sku vCPU, remaining public IPs (1 per lab).
 */
export function calcLabsFit(
  metrics: QuotaMetric[],
  sku: Pick<SkuNeeds, "vcpus" | "familyKey">,
): { labsFit: number; limitingFactor: string | null } {
  const family = findMetric(metrics, sku.familyKey);
  const cores = findMetric(metrics, "cores");
  const publicIps = findMetric(metrics, "PublicIPAddresses");

  const candidates: { label: string; n: number }[] = [];

  if (family && family.limit > 0) {
    candidates.push({
      label: family.name || sku.familyKey,
      n: Math.floor(remaining(family) / Math.max(1, sku.vcpus)),
    });
  }
  if (cores && cores.limit > 0) {
    candidates.push({
      label: cores.name || "Total Regional vCPUs",
      n: Math.floor(remaining(cores) / Math.max(1, sku.vcpus)),
    });
  }
  if (publicIps && publicIps.limit > 0) {
    candidates.push({
      label: publicIps.name || "Public IP Addresses",
      n: remaining(publicIps),
    });
  }

  if (!candidates.length) {
    return { labsFit: 0, limitingFactor: "No usable quota metrics" };
  }

  candidates.sort((a, b) => a.n - b.n);
  const worst = candidates[0];
  return { labsFit: Math.max(0, worst.n), limitingFactor: worst.label };
}

/** Pick dominant published VM size; fall back to ASSUMED_LAB_SKU. */
export function deriveSkuNeeds(vmSizes: string[]): SkuNeeds {
  const counts = new Map<string, number>();
  for (const raw of vmSizes) {
    const size = (raw || "").trim();
    if (!size) continue;
    counts.set(size, (counts.get(size) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [size, n] of counts) {
    if (n > bestCount) {
      best = size;
      bestCount = n;
    }
  }
  if (!best) {
    return {
      ...ASSUMED_LAB_SKU,
      source: "assumption",
      sampleCount: 0,
    };
  }
  const meta = AZURE_VM_SIZE_META[best] ?? {
    vcpus: ASSUMED_LAB_SKU.vcpus,
    familyKey: ASSUMED_LAB_SKU.familyKey,
    familyLabel: ASSUMED_LAB_SKU.familyLabel,
  };
  return {
    vmSize: best,
    vcpus: meta.vcpus,
    familyKey: meta.familyKey,
    familyLabel: meta.familyLabel,
    source: "lab_templates",
    sampleCount: bestCount,
  };
}

export function rankBankableRegions(rows: RegionQuotaRow[], topN = 5): RegionQuotaRow[] {
  return [...rows]
    .filter((r) => r.syncOk)
    .sort((a, b) => {
      if (b.labsFit !== a.labsFit) return b.labsFit - a.labsFit;
      if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
      return a.region.localeCompare(b.region);
    })
    .slice(0, topN);
}

export function formatSyncAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Never";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
