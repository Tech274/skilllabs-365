import { corsHeadersFor, corsHeaders, requireAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { verifyAzureSubscription } from "../_shared/azure-preflight.ts";

const AWS_SECRETS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_ROLE_ARN"];
const AZURE_SECRETS = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"];

function secretsStatus(names: string[]) {
  const out: Record<string, boolean> = {};
  for (const n of names) out[n] = Boolean(Deno.env.get(n));
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { supabase, userId } = auth;

    if (req.method === "GET") {
      const { data: rows } = await supabase.from("cloud_provider_config").select("*");
      const byProvider: Record<string, any> = {};
      for (const r of rows ?? []) byProvider[r.provider] = r;
      return jsonResponse({
        aws: {
          config: byProvider.aws?.config ?? {},
          updated_at: byProvider.aws?.updated_at ?? null,
          secrets: secretsStatus(AWS_SECRETS),
          required_secrets: AWS_SECRETS,
        },
        azure: {
          config: byProvider.azure?.config ?? {},
          updated_at: byProvider.azure?.updated_at ?? null,
          secrets: secretsStatus(AZURE_SECRETS),
          required_secrets: AZURE_SECRETS,
        },
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json().catch(() => ({}));

      // Admin probe: validate the Azure subscription + service principal access.
      if (String(body.action || "") === "test-azure-subscription") {
        const subscriptionId = String(body.subscription_id || Deno.env.get("AZURE_SUBSCRIPTION_ID") || "");
        const resourceGroup = String(body.resource_group || Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg");
        const result = await verifyAzureSubscription({
          tenantId: Deno.env.get("AZURE_TENANT_ID") ?? undefined,
          clientId: Deno.env.get("AZURE_CLIENT_ID") ?? undefined,
          clientSecret: Deno.env.get("AZURE_CLIENT_SECRET") ?? undefined,
          subscriptionId,
          resourceGroup,
        });
        return jsonResponse({ probe: result });
      }

      const provider = String(body.provider || "");
      if (!["aws", "azure"].includes(provider)) return errorResponse("provider must be aws|azure", 400);
      const config = body.config && typeof body.config === "object" ? body.config : {};
      const { error } = await supabase.from("cloud_provider_config").upsert({
        provider, config, updated_by: userId, updated_at: new Date().toISOString(),
      });
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ success: true });
    }

    return errorResponse("Method not allowed", 405);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
