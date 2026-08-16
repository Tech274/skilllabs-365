// Realtime cloud provider health probes (AWS STS + Azure ARM).
// Writes one row per check into public.cloud_provider_health_checks so the
// admin UI can subscribe over realtime.
import { corsHeaders, requireAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";

const enc = new TextEncoder();

const DEGRADED_MS = 1500;

type Check = {
  provider: string;
  check_name: string;
  status: "healthy" | "degraded" | "down" | "unconfigured";
  latency_ms: number | null;
  detail: string | null;
  region: string | null;
};

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function grade(latency: number): "healthy" | "degraded" {
  return latency > DEGRADED_MS ? "degraded" : "healthy";
}

/** STS GetCallerIdentity — cheap, read-only credential validity + latency probe. */
async function probeAws(region: string): Promise<Check> {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const sessionToken = Deno.env.get("AWS_SESSION_TOKEN");
  const base: Check = { provider: "aws", check_name: "STS GetCallerIdentity", status: "unconfigured", latency_ms: null, detail: null, region };
  if (!accessKeyId || !secretAccessKey) {
    return { ...base, detail: "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set" };
  }

  const host = "sts.amazonaws.com";
  const body = new URLSearchParams({ Action: "GetCallerIdentity", Version: "2011-06-15" }).toString();
  const bodyHash = await sha256Hex(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    host,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  const keys = Object.keys(headers).sort();
  const canonicalHeaders = keys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = keys.join(";");
  const canonical = ["POST", "/", "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const scope = `${dateStamp}/us-east-1/sts/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");
  const kDate = await hmac(enc.encode("AWS4" + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, "us-east-1");
  const kService = await hmac(kRegion, "sts");
  const kSigning = await hmac(kService, "aws4_request");
  const sig = [...await hmac(kSigning, stringToSign)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const started = Date.now();
  try {
    const resp = await fetch(`https://${host}/`, {
      method: "POST",
      headers: { ...headers, authorization, accept: "application/json" },
      body,
    });
    const latency = Date.now() - started;
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200);
      return { ...base, status: "down", latency_ms: latency, detail: `HTTP ${resp.status}: ${text}` };
    }
    await resp.text();
    return { ...base, status: grade(latency), latency_ms: latency, detail: "Credentials valid" };
  } catch (e) {
    return { ...base, status: "down", latency_ms: Date.now() - started, detail: e instanceof Error ? e.message : "Request failed" };
  }
}

async function probeAzureToken(): Promise<{ check: Check; token: string | null }> {
  const tenant = Deno.env.get("AZURE_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET");
  const base: Check = { provider: "azure", check_name: "Entra ID token", status: "unconfigured", latency_ms: null, detail: null, region: null };
  if (!tenant || !clientId || !secret) {
    return { check: { ...base, detail: "AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET not set" }, token: null };
  }
  const started = Date.now();
  try {
    const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: secret,
        scope: "https://management.azure.com/.default",
      }),
    });
    const latency = Date.now() - started;
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200);
      return { check: { ...base, status: "down", latency_ms: latency, detail: `HTTP ${resp.status}: ${text}` }, token: null };
    }
    const json = await resp.json();
    return {
      check: { ...base, status: grade(latency), latency_ms: latency, detail: "Service principal authenticated" },
      token: json.access_token as string,
    };
  } catch (e) {
    return { check: { ...base, status: "down", latency_ms: Date.now() - started, detail: e instanceof Error ? e.message : "Request failed" }, token: null };
  }
}

async function probeAzureArm(token: string | null): Promise<Check> {
  const subscription = Deno.env.get("AZURE_SUBSCRIPTION_ID");
  const base: Check = { provider: "azure", check_name: "ARM subscription", status: "unconfigured", latency_ms: null, detail: null, region: null };
  if (!token) return { ...base, status: "down", detail: "No Entra ID token — token probe failed" };
  if (!subscription) return { ...base, detail: "AZURE_SUBSCRIPTION_ID not set" };
  const started = Date.now();
  try {
    const resp = await fetch(
      `https://management.azure.com/subscriptions/${subscription}?api-version=2022-12-01`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const latency = Date.now() - started;
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200);
      return { ...base, status: "down", latency_ms: latency, detail: `HTTP ${resp.status}: ${text}` };
    }
    const json = await resp.json();
    return { ...base, status: grade(latency), latency_ms: latency, detail: `State: ${json.state ?? "unknown"}` };
  } catch (e) {
    return { ...base, status: "down", latency_ms: Date.now() - started, detail: e instanceof Error ? e.message : "Request failed" };
  }
}

async function probeAzureCompute(token: string | null, region: string): Promise<Check> {
  const subscription = Deno.env.get("AZURE_SUBSCRIPTION_ID");
  const base: Check = { provider: "azure", check_name: "Compute quota API", status: "unconfigured", latency_ms: null, detail: null, region };
  if (!token || !subscription) return { ...base, detail: "Azure credentials incomplete" };
  const started = Date.now();
  try {
    const resp = await fetch(
      `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const latency = Date.now() - started;
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200);
      return { ...base, status: "down", latency_ms: latency, detail: `HTTP ${resp.status}: ${text}` };
    }
    const json = await resp.json();
    const cores = (json.value ?? []).find((u: { name?: { value?: string } }) => u.name?.value === "cores");
    const detail = cores ? `Cores ${cores.currentValue}/${cores.limit}` : "Usages reachable";
    const nearCap = cores && cores.limit > 0 && cores.currentValue / cores.limit >= 0.9;
    return { ...base, status: nearCap ? "degraded" : grade(latency), latency_ms: latency, detail: nearCap ? `${detail} — near quota cap` : detail };
  } catch (e) {
    return { ...base, status: "down", latency_ms: Date.now() - started, detail: e instanceof Error ? e.message : "Request failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { supabase } = auth;

    const url = new URL(req.url);
    const awsRegion = url.searchParams.get("aws_region") || "us-east-1";
    const azureRegion = url.searchParams.get("azure_region") || "eastus";

    const [awsCheck, azureToken] = await Promise.all([probeAws(awsRegion), probeAzureToken()]);
    const [armCheck, computeCheck] = await Promise.all([
      probeAzureArm(azureToken.token),
      probeAzureCompute(azureToken.token, azureRegion),
    ]);

    const checks: Check[] = [awsCheck, azureToken.check, armCheck, computeCheck];
    const checked_at = new Date().toISOString();

    const { error } = await supabase
      .from("cloud_provider_health_checks")
      .insert(checks.map((c) => ({ ...c, checked_at })));
    if (error) console.error("health insert failed:", error.message);

    return jsonResponse({ checked_at, checks });
  } catch (e) {
    console.error("cloud-provider-health error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
