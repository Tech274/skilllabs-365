// Resource Provider (cloud provider account) registry helpers.
// Credentials live in public.cloud_provider_accounts.credentials which is readable
// only with the service role — never exposed to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

export type ProviderKey =
  | "aws" | "azure" | "gcp" | "oci" | "ibm" | "alibaba" | "digitalocean" | "other";

export interface ProviderAccount {
  id: string;
  provider: ProviderKey;
  slug: string;
  display_name: string;
  status: string;
  is_default: boolean;
  default_region: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
}

/** Fields that are safe to return to an admin UI (never the credential values). */
export const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; required: boolean }[]> = {
  aws: [
    { key: "access_key_id", label: "AWS Access Key ID", required: true },
    { key: "secret_access_key", label: "AWS Secret Access Key", required: true },
    { key: "session_token", label: "Session Token (optional)", required: false },
  ],
  azure: [
    { key: "tenant_id", label: "Directory (tenant) ID", required: true },
    { key: "client_id", label: "Application (client) ID", required: true },
    { key: "client_secret", label: "Client Secret Value", required: true },
  ],
  gcp: [
    { key: "service_account_json", label: "Service Account JSON", required: true },
  ],
};

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Mask a credentials object for display: keeps only which keys are set. */
export function maskCredentials(creds: Record<string, unknown> | null | undefined) {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(creds ?? {})) out[k] = Boolean(v && String(v).length);
  return out;
}

/**
 * Resolve the provider account to use for a template:
 * explicit provider_account_id → provider default → null.
 */
export async function resolveAccount(
  admin: any,
  provider: ProviderKey,
  accountId?: string | null,
): Promise<ProviderAccount | null> {
  if (accountId) {
    const { data } = await admin.from("cloud_provider_accounts").select("*").eq("id", accountId).maybeSingle();
    if (data && data.status === "active") return data as ProviderAccount;
    if (data) throw new Error(`Resource provider "${data.display_name}" is disabled. Enable it in Admin → Resource Providers.`);
  }
  const { data: def } = await admin
    .from("cloud_provider_accounts").select("*")
    .eq("provider", provider).eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  return (def as ProviderAccount | null) ?? null;
}

/** Live connectivity test for an account. Returns { ok, message, details }. */
export async function testAccount(account: {
  provider: string;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
}): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const { provider, config, credentials } = account;
  try {
    if (provider === "azure") {
      const tenant = credentials.tenant_id, clientId = credentials.client_id, secret = credentials.client_secret;
      if (!tenant || !clientId || !secret) return { ok: false, message: "Tenant ID, Client ID and Client Secret are required." };
      const body = new URLSearchParams({
        grant_type: "client_credentials", client_id: clientId, client_secret: secret,
        resource: "https://management.azure.com/",
      });
      const tokRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
      });
      const tokTxt = await tokRes.text();
      if (!tokRes.ok) return { ok: false, message: `Azure sign-in failed (${tokRes.status}): ${tokTxt.slice(0, 300)}` };
      const token = JSON.parse(tokTxt).access_token as string;

      const sub = String(config.subscription_id || "");
      if (!sub) return { ok: true, message: "Credentials valid. Add a subscription ID to validate access scope." };
      const subRes = await fetch(`https://management.azure.com/subscriptions/${sub}?api-version=2020-01-01`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const subTxt = await subRes.text();
      if (!subRes.ok) {
        return { ok: false, message: `Subscription check failed (${subRes.status}): ${subTxt.slice(0, 300)}` };
      }
      const subJson = JSON.parse(subTxt);
      return {
        ok: true,
        message: `Connected to "${subJson.displayName ?? sub}" (${subJson.state ?? "unknown state"}).`,
        details: { subscription_id: sub, display_name: subJson.displayName, state: subJson.state },
      };
    }

    if (provider === "aws") {
      const { stsGetCallerIdentity } = await import("./aws.ts");
      if (!credentials.access_key_id || !credentials.secret_access_key) {
        return { ok: false, message: "Access Key ID and Secret Access Key are required." };
      }
      const id = await stsGetCallerIdentity({
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
        sessionToken: credentials.session_token || null,
      });
      return { ok: true, message: `Connected as ${id.Arn ?? id.Account}.`, details: id };
    }

    return { ok: false, message: `Connection testing is not available for ${provider} yet.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection test failed" };
  }
}
