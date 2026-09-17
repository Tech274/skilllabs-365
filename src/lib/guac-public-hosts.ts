/**
 * Browser-side Guacamole public host map (mirrors edge `_shared/guac-hosts.ts`).
 * Locked hostnames:
 *   aws   → https://guac.skillhub365.co.in
 *   azure → https://guac-azure.skillhub365.co.in
 */

export type GuacCloudProvider = "aws" | "azure";

export const DEFAULT_GUAC_PUBLIC_BY_PROVIDER: Record<GuacCloudProvider, string> = {
  aws: "https://guac.skillhub365.co.in",
  azure: "https://guac-azure.skillhub365.co.in",
};

export const KNOWN_GUAC_PUBLIC_HOSTS = new Set(
  Object.values(DEFAULT_GUAC_PUBLIC_BY_PROVIDER).map((u) => new URL(u).hostname),
);

export function normalizeGuacCloudProvider(raw: unknown): GuacCloudProvider {
  const p = String(raw ?? "").trim().toLowerCase();
  if (p === "azure" || p === "az") return "azure";
  return "aws";
}

export function publicGuacBaseForProvider(provider?: GuacCloudProvider | string | null): string {
  const p = normalizeGuacCloudProvider(provider ?? "aws");
  return DEFAULT_GUAC_PUBLIC_BY_PROVIDER[p];
}
