import { corsHeaders, requireAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";

const AWS_SECRETS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_ROLE_ARN"];
const AZURE_SECRETS = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"];

function secretsStatus(names: string[]) {
  const out: Record<string, boolean> = {};
  for (const n of names) out[n] = Boolean(Deno.env.get(n));
  return out;
}

Deno.serve(async (req) => {
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
