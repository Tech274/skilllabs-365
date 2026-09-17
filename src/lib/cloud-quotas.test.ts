import { describe, expect, it } from "vitest";
import {
  ASSUMED_LAB_SKU,
  AZURE_HOME_REGION,
  calcLabsFit,
  deriveSkuNeeds,
  formatSyncAgo,
  rankBankableRegions,
  remaining,
  type RegionQuotaRow,
} from "./cloud-quotas";

describe("cloud-quotas capacity helpers", () => {
  it("keeps Central India as Azure home (not southindia)", () => {
    expect(AZURE_HOME_REGION).toBe("centralindia");
    expect(AZURE_HOME_REGION).not.toBe("southindia");
  });

  it("derives SKU from published lab template sizes", () => {
    const sku = deriveSkuNeeds(["Standard_B2s", "Standard_B2s", "Standard_D2s_v3"]);
    expect(sku.vmSize).toBe("Standard_B2s");
    expect(sku.vcpus).toBe(2);
    expect(sku.familyKey).toBe("standardBSFamily");
    expect(sku.source).toBe("lab_templates");
    expect(sku.sampleCount).toBe(2);
  });

  it("falls back to assumption constants when no templates", () => {
    const sku = deriveSkuNeeds([]);
    expect(sku).toMatchObject({
      ...ASSUMED_LAB_SKU,
      source: "assumption",
      sampleCount: 0,
    });
  });

  it("calculates labs fit from the tightest remaining metric", () => {
    const { labsFit, limitingFactor } = calcLabsFit(
      [
        { key: "standardBSFamily", name: "BS Family", currentUsage: 10, limit: 20, unit: "Count" },
        { key: "cores", name: "Total cores", currentUsage: 4, limit: 100, unit: "Count" },
        { key: "PublicIPAddresses", name: "Public IPs", currentUsage: 0, limit: 3, unit: "Count" },
      ],
      { vcpus: 2, familyKey: "standardBSFamily" },
    );
    // family rem 10 / 2 = 5; cores rem 96 / 2 = 48; public IP = 3 → limited by public IP
    expect(labsFit).toBe(3);
    expect(limitingFactor).toMatch(/Public/i);
  });

  it("ranks bankable regions by labsFit and prefers home on ties", () => {
    const rows: RegionQuotaRow[] = [
      {
        region: "eastus",
        displayName: "East US",
        isHome: false,
        metrics: [],
        labsFit: 10,
        limitingFactor: "x",
        syncOk: true,
      },
      {
        region: "centralindia",
        displayName: "Central India",
        isHome: true,
        metrics: [],
        labsFit: 10,
        limitingFactor: "x",
        syncOk: true,
      },
      {
        region: "uksouth",
        displayName: "UK South",
        isHome: false,
        metrics: [],
        labsFit: 40,
        limitingFactor: "x",
        syncOk: true,
      },
      {
        region: "southindia",
        displayName: "South India",
        isHome: false,
        metrics: [],
        labsFit: 100,
        limitingFactor: "x",
        syncOk: false,
      },
    ];
    const top = rankBankableRegions(rows, 5);
    expect(top.map((r) => r.region)).toEqual(["uksouth", "centralindia", "eastus"]);
    expect(top.every((r) => r.syncOk)).toBe(true);
  });

  it("computes remaining safely", () => {
    expect(remaining({ key: "a", name: "a", currentUsage: 8, limit: 10, unit: "Count" })).toBe(2);
    expect(remaining({ key: "a", name: "a", currentUsage: 12, limit: 10, unit: "Count" })).toBe(0);
    expect(remaining(undefined)).toBe(0);
  });

  it("formats sync ago", () => {
    const now = Date.parse("2026-09-17T10:00:00Z");
    expect(formatSyncAgo(new Date(now - 30_000).toISOString(), now)).toBe("30s ago");
    expect(formatSyncAgo(null, now)).toBe("Never");
  });
});
