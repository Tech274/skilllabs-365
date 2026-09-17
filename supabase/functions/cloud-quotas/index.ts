/**
 * Admin Cloud Quotas — Azure live sync + AWS stub.
 *
 * Actions (JSON body):
 *   { action: "status" }                         → sync state + snapshots for azure & aws
 *   { action: "sync", provider: "azure"|"aws" }  → refresh that provider
 *
 * Azure: Microsoft.Compute + Microsoft.Network location usages (real).
 * Sync keeps the **full VM family set** Azure returns (*Family keys) — not BS-only —
 * plus cores / virtualMachines / Public IPs. Per-family limit/usage/remaining is in
 * each region row so Ops can pick Launch Lab SKU fallbacks with eyes open.
 * AWS: Service Quotas API not wired — records not_connected stub.
 * Home region: Azure centralindia (NOT southindia); AWS ap-south-1.
 */
import { corsHeadersFor, requireAdmin } from "../_shared/auth.ts";
import { resolveAzureRuntime, ProviderConfigError } from "../_shared/cloud-providers/azure-runtime.ts";

type Provider = "azure" | "aws";

const AZURE_HOME = "centralindia";
const AWS_HOME = "ap-south-1";

const AZURE_REGIONS = [
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

const AZURE_REGION_LABELS: Record<string, string> = {
  centralindia: "Central India",
  southindia: "South India",
  eastus: "East US",
  southeastasia: "Southeast Asia",
  northeurope: "North Europe",
  uksouth: "UK South",
  westus2: "West US 2",
  westeurope: "West Europe",
  japaneast: "Japan East",
  australiaeast: "Australia East",
};

const AWS_REGIONS = [
  "ap-south-1",
  "ap-southeast-1",
  "us-east-1",
  "eu-west-1",
  "us-west-2",
  "ap-northeast-1",
  "eu-central-1",
  "ap-southeast-2",
] as const;

const AWS_REGION_LABELS: Record<string, string> = {
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "us-east-1": "US East (N. Virginia)",
  "eu-west-1": "Europe (Ireland)",
  "us-west-2": "US West (Oregon)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "eu-central-1": "Europe (Frankfurt)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
};

const ASSUMED_SKU = {
  vmSize: "Standard_B2s",
  vcpus: 2,
  familyKey: "standardBSFamily",
  familyLabel: "Standard BS Family vCPUs",
};

const AZURE_VM_SIZE_META: Record<string, { vcpus: number; familyKey: string; familyLabel: string }> = {
  Standard_B1s: { vcpus: 1, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B1ms: { vcpus: 1, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B2s: { vcpus: 2, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B2ms: { vcpus: 2, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_B4ms: { vcpus: 4, familyKey: "standardBSFamily", familyLabel: "Standard BS Family vCPUs" },
  Standard_D2s_v3: { vcpus: 2, familyKey: "standardDSv3Family", familyLabel: "Standard DSv3 Family vCPUs" },
  Standard_D4s_v3: { vcpus: 4, familyKey: "standardDSv3Family", familyLabel: "Standard DSv3 Family vCPUs" },
  Standard_D2s_v5: { vcpus: 2, familyKey: "standardDSv5Family", familyLabel: "Standard DSv5 Family vCPUs" },
  Standard_D4s_v5: { vcpus: 4, familyKey: "standardDSv5Family", familyLabel: "Standard DSv5 Family vCPUs" },
  Standard_D2as_v5: { vcpus: 2, familyKey: "standardDASv5Family", familyLabel: "Standard DASv5 Family vCPUs" },
  Standard_D4as_v5: { vcpus: 4, familyKey: "standardDASv5Family", familyLabel: "Standard DASv5 Family vCPUs" },
  Standard_E2s_v3: { vcpus: 2, familyKey: "standardESv3Family", familyLabel: "Standard ESv3 Family vCPUs" },
  Standard_F2s_v2: { vcpus: 2, familyKey: "standardFSv2Family", familyLabel: "Standard FSv2 Family vCPUs" },
};

/** Lab-relevant families (always prefer; sync still keeps every *Family Azure returns). */
const LAB_RELEVANT_FAMILY_KEYS = [
  "standardBSFamily",
  "standardDSv2Family",
  "standardDSv3Family",
  "standardDSv5Family",
  "standardDASv5Family",
  "standardESv3Family",
  "standardFSv2Family",
] as const;
const LAB_RELEVANT_SET = new Set<string>(LAB_RELEVANT_FAMILY_KEYS);

function isAzureFamilyUsageKey(key: string): boolean {
  return /Family$/i.test(key || "");
}

/** Persist every *Family Azure returns + cores / virtualMachines (not BS-only). */
function shouldKeepComputeUsage(key: string, skuFamilyKey?: string): boolean {
  if (!key) return false;
  if (key === "cores" || key === "virtualMachines") return true;
  if (isAzureFamilyUsageKey(key)) return true;
  if (skuFamilyKey && key === skuFamilyKey) return true;
  return false;
}

type Metric = {
  name: string;
  key: string;
  currentUsage: number;
  limit: number;
  unit: string;
};

type FamilyQuota = {
  key: string;
  name: string;
  currentUsage: number;
  limit: number;
  remaining: number;
  unit: string;
  labsFit: number;
  labRelevant: boolean;
};

type RegionRow = {
  region: string;
  displayName: string;
  isHome: boolean;
  metrics: Metric[];
  families: FamilyQuota[];
  labsFit: number;
  limitingFactor: string | null;
  syncOk: boolean;
  syncError?: string | null;
};

function deriveSku(vmSizes: string[]) {
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
    return { ...ASSUMED_SKU, source: "assumption" as const, sampleCount: 0 };
  }
  const meta = AZURE_VM_SIZE_META[best] ?? {
    vcpus: ASSUMED_SKU.vcpus,
    familyKey: ASSUMED_SKU.familyKey,
    familyLabel: ASSUMED_SKU.familyLabel,
  };
  return {
    vmSize: best,
    vcpus: meta.vcpus,
    familyKey: meta.familyKey,
    familyLabel: meta.familyLabel,
    source: "lab_templates" as const,
    sampleCount: bestCount,
  };
}

function remaining(m: Metric | undefined): number {
  if (!m || m.limit <= 0) return 0;
  return Math.max(0, m.limit - m.currentUsage);
}

function buildFamilies(metrics: Metric[], skuVcpus: number): FamilyQuota[] {
  const vcpus = Math.max(1, skuVcpus);
  const rows: FamilyQuota[] = [];
  for (const m of metrics) {
    if (!isAzureFamilyUsageKey(m.key)) continue;
    const rem = remaining(m);
    rows.push({
      key: m.key,
      name: m.name || m.key,
      currentUsage: m.currentUsage,
      limit: m.limit,
      remaining: rem,
      unit: m.unit || "Count",
      labsFit: m.limit > 0 ? Math.floor(rem / vcpus) : 0,
      labRelevant: LAB_RELEVANT_SET.has(m.key),
    });
  }
  rows.sort((a, b) => {
    if (a.labRelevant !== b.labRelevant) return a.labRelevant ? -1 : 1;
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function calcLabsFit(metrics: Metric[], sku: { vcpus: number; familyKey: string }) {
  const family = metrics.find((m) => m.key === sku.familyKey);
  const cores = metrics.find((m) => m.key === "cores");
  const publicIps = metrics.find((m) => m.key === "PublicIPAddresses");
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
  if (!candidates.length) return { labsFit: 0, limitingFactor: "No usable quota metrics" };
  candidates.sort((a, b) => a.n - b.n);
  return { labsFit: Math.max(0, candidates[0].n), limitingFactor: candidates[0].label };
}

async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure auth failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function fetchAzureRegion(
  token: string,
  subscriptionId: string,
  region: string,
  sku: { vcpus: number; familyKey: string },
): Promise<RegionRow> {
  const headers = { Authorization: `Bearer ${token}` };
  const computeUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`;
  const networkUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Network/locations/${region}/usages?api-version=2023-09-01`;

  const [computeRes, networkRes] = await Promise.all([
    fetch(computeUrl, { headers }),
    fetch(networkUrl, { headers }),
  ]);

  if (!computeRes.ok) {
    const body = await computeRes.text();
    return {
      region,
      displayName: AZURE_REGION_LABELS[region] || region,
      isHome: region === AZURE_HOME,
      metrics: [],
      families: [],
      labsFit: 0,
      limitingFactor: null,
      syncOk: false,
      syncError: `Compute usages ${computeRes.status}: ${body.slice(0, 200)}`,
    };
  }

  const computeJson = await computeRes.json();
  const metrics: Metric[] = [];
  for (const usage of computeJson.value || []) {
    const key = usage.name?.value || "";
    // Full family set from Azure — not a BS-only allowlist
    if (!shouldKeepComputeUsage(key, sku.familyKey)) continue;
    metrics.push({
      name: usage.name?.localizedValue || key,
      key,
      currentUsage: Number(usage.currentValue) || 0,
      limit: Number(usage.limit) || 0,
      unit: usage.unit || "Count",
    });
  }

  if (networkRes.ok) {
    const networkJson = await networkRes.json();
    for (const usage of networkJson.value || []) {
      const key = usage.name?.value || "";
      if (key !== "PublicIPAddresses" && key !== "StaticPublicIPAddresses") continue;
      metrics.push({
        name: usage.name?.localizedValue || key,
        key,
        currentUsage: Number(usage.currentValue) || 0,
        limit: Number(usage.limit) || 0,
        unit: usage.unit || "Count",
      });
    }
  }

  const { labsFit, limitingFactor } = calcLabsFit(metrics, sku);
  const families = buildFamilies(metrics, sku.vcpus);
  return {
    region,
    displayName: AZURE_REGION_LABELS[region] || region,
    isHome: region === AZURE_HOME,
    metrics,
    families,
    labsFit,
    limitingFactor,
    syncOk: true,
    syncError: networkRes.ok ? null : `Network usages ${networkRes.status} (public IP omitted)`,
  };
}

async function loadSkuNeeds(supabase: any) {
  const { data } = await supabase
    .from("lab_templates")
    .select("vm_size")
    .eq("status", "published");
  return deriveSku((data ?? []).map((r: { vm_size?: string }) => String(r.vm_size ?? "")));
}

async function syncAzure(supabase: any) {
  const sku = await loadSkuNeeds(supabase);
  const azure = await resolveAzureRuntime(supabase, null);
  const token = await getAzureToken(azure.tenantId, azure.clientId, azure.clientSecret);

  const regions: RegionRow[] = [];
  // Sequential batches of 3 to avoid ARM throttling
  for (let i = 0; i < AZURE_REGIONS.length; i += 3) {
    const batch = AZURE_REGIONS.slice(i, i + 3);
    const rows = await Promise.all(
      batch.map((r) => fetchAzureRegion(token, azure.subscriptionId, r, sku)),
    );
    regions.push(...rows);
  }

  const okCount = regions.filter((r) => r.syncOk).length;
  const failCount = regions.length - okCount;
  const status = okCount > 0 ? "ok" : "fail";
  const familyKeys = new Set<string>();
  for (const r of regions) {
    for (const f of r.families) familyKeys.add(f.key);
  }
  const reason = failCount === 0
    ? `Synced ${okCount} regions (home=${AZURE_HOME}); ${familyKeys.size} VM families`
    : okCount > 0
    ? `Partial sync: ${okCount} ok, ${failCount} failed; ${familyKeys.size} VM families`
    : `All region syncs failed`;

  const snapshot = {
    provider: "azure" as const,
    homeRegion: AZURE_HOME,
    syncedAt: new Date().toISOString(),
    sku,
    account: { id: azure.accountId, displayName: azure.displayName, subscriptionId: azure.subscriptionId },
    regions,
    familyKeys: [...familyKeys].sort(),
    labRelevantFamilies: [...LAB_RELEVANT_FAMILY_KEYS],
    provisionFallbackChain: [
      "Standard_B2s",
      "Standard_B2ms",
      "Standard_D2s_v3",
      "Standard_D2s_v5",
      "Standard_D2as_v5",
    ],
    mode: "live" as const,
  };

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("cloud_quota_sync_state")
    .select("last_ok_at, last_fail_at")
    .eq("provider", "azure")
    .maybeSingle();

  await supabase.from("cloud_quota_sync_state").upsert({
    provider: "azure",
    last_status: status,
    last_reason: reason,
    last_ok_at: status === "ok" ? now : existing?.last_ok_at ?? null,
    last_fail_at: status === "fail" ? now : existing?.last_fail_at ?? null,
    last_synced_at: now,
    home_region: AZURE_HOME,
    snapshot,
    updated_at: now,
  });

  return { sync: { provider: "azure", status, reason, syncedAt: now }, snapshot };
}

async function syncAws(supabase: any) {
  const sku = await loadSkuNeeds(supabase);
  const now = new Date().toISOString();
  const reason =
    "AWS Service Quotas API not wired in Hub v1. Resource Providers can store AWS credentials for STS federation, but quota sync is stubbed. Configure when Service Quotas (ec2) is connected.";

  // Optional: check whether an active AWS account exists (still stub quotas)
  const { data: awsAccount } = await supabase
    .from("cloud_provider_accounts")
    .select("id, display_name, status, default_region")
    .eq("provider", "aws")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const regions: RegionRow[] = AWS_REGIONS.map((region) => ({
    region,
    displayName: AWS_REGION_LABELS[region] || region,
    isHome: region === AWS_HOME,
    metrics: [],
    families: [],
    labsFit: 0,
    limitingFactor: "AWS quotas not connected",
    syncOk: false,
    syncError: "not_connected",
  }));

  const snapshot = {
    provider: "aws" as const,
    homeRegion: AWS_HOME,
    syncedAt: now,
    sku,
    account: awsAccount
      ? { id: awsAccount.id, displayName: awsAccount.display_name, defaultRegion: awsAccount.default_region }
      : null,
    regions,
    familyKeys: [] as string[],
    mode: "stub" as const,
    gap: reason,
  };

  const { data: existing } = await supabase
    .from("cloud_quota_sync_state")
    .select("last_ok_at, last_fail_at")
    .eq("provider", "aws")
    .maybeSingle();

  await supabase.from("cloud_quota_sync_state").upsert({
    provider: "aws",
    last_status: "not_connected",
    last_reason: reason,
    last_ok_at: existing?.last_ok_at ?? null,
    last_fail_at: now,
    last_synced_at: now,
    home_region: AWS_HOME,
    snapshot,
    updated_at: now,
  });

  return {
    sync: { provider: "aws", status: "not_connected", reason, syncedAt: now },
    snapshot,
  };
}

async function loadStatus(supabase: any) {
  const { data, error } = await supabase
    .from("cloud_quota_sync_state")
    .select("*")
    .in("provider", ["azure", "aws"]);
  if (error) throw new Error(error.message);

  const byProvider: Record<string, unknown> = {};
  for (const row of data ?? []) {
    byProvider[String(row.provider)] = row;
  }

  // Seed rows if migration applied but empty somehow
  for (const p of ["azure", "aws"] as Provider[]) {
    if (!byProvider[p]) {
      byProvider[p] = {
        provider: p,
        last_status: p === "aws" ? "not_connected" : "never",
        last_reason: p === "aws"
          ? "AWS Service Quotas API not wired in Hub v1"
          : "Not synced yet",
        last_ok_at: null,
        last_fail_at: null,
        last_synced_at: null,
        home_region: p === "azure" ? AZURE_HOME : AWS_HOME,
        snapshot: {},
      };
    }
  }

  return {
    home: { azure: AZURE_HOME, aws: AWS_HOME },
    providers: byProvider,
  };
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = await requireAdmin(req);
  if (admin instanceof Response) {
    // requireAdmin already built CORS-less body via shared helper; re-wrap with cors
    const body = await admin.text();
    return new Response(body, {
      status: admin.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    let action = "status";
    let provider: Provider | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      action = url.searchParams.get("action") || "status";
      const p = url.searchParams.get("provider");
      if (p === "azure" || p === "aws") provider = p;
    } else {
      const body = await req.json().catch(() => ({}));
      action = String(body.action || "status");
      if (body.provider === "azure" || body.provider === "aws") provider = body.provider;
    }

    if (action === "status") {
      const status = await loadStatus(admin.supabase);
      return new Response(JSON.stringify(status), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (action === "sync") {
      if (!provider) {
        return new Response(JSON.stringify({ error: "provider required (azure|aws)" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      try {
        const result = provider === "azure"
          ? await syncAzure(admin.supabase)
          : await syncAws(admin.supabase);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (err) {
        const message = err instanceof ProviderConfigError
          ? err.message
          : err instanceof Error ? err.message : "Sync failed";
        const now = new Date().toISOString();
        const { data: existing } = await admin.supabase
          .from("cloud_quota_sync_state")
          .select("last_ok_at, snapshot, home_region")
          .eq("provider", provider)
          .maybeSingle();
        await admin.supabase.from("cloud_quota_sync_state").upsert({
          provider,
          last_status: provider === "aws" ? "not_connected" : "fail",
          last_reason: message,
          last_fail_at: now,
          last_ok_at: existing?.last_ok_at ?? null,
          last_synced_at: now,
          home_region: existing?.home_region ?? (provider === "azure" ? AZURE_HOME : AWS_HOME),
          snapshot: existing?.snapshot ?? {},
          updated_at: now,
        });
        return new Response(JSON.stringify({
          error: message,
          sync: { provider, status: "fail", reason: message, syncedAt: now },
        }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("cloud-quotas error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
