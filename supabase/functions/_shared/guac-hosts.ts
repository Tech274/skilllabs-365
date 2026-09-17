/**
 * Dual Guacamole gateways by cloud provider.
 *
 * Public iframe hosts (browser-facing, HTTPS):
 *   aws   → https://guac.skillhub365.co.in        (existing EC2 3.6.228.159)
 *   azure → https://guac-azure.skillhub365.co.in  (Azure Guac VM — map ready now)
 *
 * Admin API (server-side only, never sent to the browser):
 *   aws   → GUACAMOLE_URL + GUACAMOLE_ADMIN_*
 *   azure → GUACAMOLE_AZURE_URL + GUACAMOLE_AZURE_ADMIN_*
 *           with fallback to the legacy single vars until Azure Guac is deployed.
 *
 * Pairing rule: until GUACAMOLE_AZURE_URL is set, Azure labs keep using the AWS
 * public host so minted tokens match the admin API that issued them.
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
  // aws / amazon / empty / other clouds → AWS Guac (only gateway deployed today)
  return "aws";
}

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function asHttpsOrigin(raw: string): string {
  const trimmed = stripTrailingSlash(raw);
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type GuacEnv = { get(key: string): string | undefined };

/** Browser-facing Guac origin for a cloud provider (no path required). */
export function resolveGuacPublicBase(
  provider: GuacCloudProvider | string,
  env: GuacEnv = Deno.env,
): string {
  const p = normalizeGuacCloudProvider(provider);

  if (p === "azure") {
    const explicit = env.get("GUACAMOLE_AZURE_PUBLIC_URL")?.trim();
    if (explicit) return asHttpsOrigin(explicit);

    // No dedicated Azure Guac admin API yet → keep iframe on AWS public host
    // so tokens minted against GUACAMOLE_URL remain valid in the browser.
    const azureAdmin = env.get("GUACAMOLE_AZURE_URL")?.trim();
    if (!azureAdmin) {
      return resolveGuacPublicBase("aws", env);
    }
    return DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure;
  }

  const awsExplicit =
    env.get("GUACAMOLE_AWS_PUBLIC_URL")?.trim() ||
    env.get("GUACAMOLE_PUBLIC_URL")?.trim();
  if (awsExplicit) return asHttpsOrigin(awsExplicit);
  return DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws;
}

export type GuacAdminEndpoint = {
  provider: GuacCloudProvider;
  /** Admin / API base (may be http://IP:8080/guacamole). */
  adminUrl: string;
  adminUsername: string;
  adminPassword: string;
  /** Browser-facing HTTPS origin for iframe_url. */
  publicBase: string;
};

/**
 * Resolve admin API + public iframe base for a lab's cloud provider.
 * Azure prefers GUACAMOLE_AZURE_* and falls back to legacy GUACAMOLE_* (AWS).
 */
export function resolveGuacAdminEndpoint(
  provider: GuacCloudProvider | string,
  env: GuacEnv = Deno.env,
): GuacAdminEndpoint {
  const p = normalizeGuacCloudProvider(provider);
  const publicBase = resolveGuacPublicBase(p, env);

  if (p === "azure") {
    const adminUrl =
      env.get("GUACAMOLE_AZURE_URL")?.trim() ||
      env.get("GUACAMOLE_URL")?.trim() ||
      "";
    const adminUsername =
      env.get("GUACAMOLE_AZURE_ADMIN_USERNAME")?.trim() ||
      env.get("GUACAMOLE_ADMIN_USERNAME")?.trim() ||
      "";
    const adminPassword =
      env.get("GUACAMOLE_AZURE_ADMIN_PASSWORD")?.trim() ||
      env.get("GUACAMOLE_ADMIN_PASSWORD")?.trim() ||
      "";
    return { provider: p, adminUrl, adminUsername, adminPassword, publicBase };
  }

  return {
    provider: "aws",
    adminUrl: env.get("GUACAMOLE_URL")?.trim() || "",
    adminUsername: env.get("GUACAMOLE_ADMIN_USERNAME")?.trim() || "",
    adminPassword: env.get("GUACAMOLE_ADMIN_PASSWORD")?.trim() || "",
    publicBase,
  };
}

/**
 * Build the browser iframe base from the public origin, preserving /guacamole
 * when the admin API base includes that path suffix.
 */
export function toPublicIframeBase(apiBaseUrl: string, publicBaseRaw: string): string {
  const publicBase = asHttpsOrigin(publicBaseRaw || DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);
  try {
    const api = new URL(apiBaseUrl);
    const pub = new URL(publicBase);
    pub.protocol = "https:";
    const apiPath = api.pathname.replace(/\/+$/, "") || "";
    let pubPath = pub.pathname.replace(/\/+$/, "") || "";
    if (apiPath.endsWith("/guacamole") && !pubPath.endsWith("/guacamole")) {
      pubPath = `${pubPath}/guacamole`.replace(/\/+/g, "/");
    } else if (!pubPath && apiPath) {
      pubPath = apiPath;
    }
    return `${pub.origin}${pubPath}`;
  } catch {
    return `${DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws}/guacamole`;
  }
}

export function buildPublicIframeUrl(
  apiBaseUrl: string,
  publicBaseRaw: string,
  clientId: string,
  token: string,
): string {
  const base = toPublicIframeBase(apiBaseUrl, publicBaseRaw);
  return `${base}/#/client/${encodeURIComponent(clientId)}?token=${token}`;
}
