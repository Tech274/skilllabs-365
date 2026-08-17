// Admin CRUD + connection testing for Resource Providers (cloud provider accounts).
// Credentials never leave the server: reads return a masked map of which keys are set.
import { corsHeadersFor, requireAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { serviceClient, maskCredentials, testAccount, CREDENTIAL_FIELDS } from "../_shared/cloud-providers/accounts.ts";
import { azureRuntimeFromAccount, listAzureNetworks, vmProvisioningGaps } from "../_shared/cloud-providers/azure-runtime.ts";

const PROVIDERS = ["aws", "azure", "gcp", "oci", "ibm", "alibaba", "digitalocean", "other"];

function publicRow(row: any) {
  const { credentials, ...rest } = row;
  let readiness: { ready: boolean; missing: { field: string; label: string }[] } | null = null;
  if (row.provider === "azure") {
    try {
      const runtime = azureRuntimeFromAccount({ ...row, credentials: credentials ?? {} });
      const missing = vmProvisioningGaps(runtime);
      readiness = { ready: missing.length === 0, missing };
    } catch (e) {
      readiness = {
        ready: false,
        missing: [{ field: "account", label: e instanceof Error ? e.message : "Account incomplete" }],
      };
    }
  }
  return { ...rest, credential_keys: maskCredentials(credentials), readiness };
}

function slugify(input: string) {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const admin = serviceClient();

    let body: Record<string, any> = {};
    if (req.method !== "GET") {
      try { body = await req.json(); } catch { /* empty */ }
    }
    const action = String(body.action || (req.method === "GET" ? "list" : ""));

    if (action === "list") {
      const { data, error } = await admin
        .from("cloud_provider_accounts").select("*").order("provider").order("display_name");
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ accounts: (data ?? []).map(publicRow), credential_fields: CREDENTIAL_FIELDS });
    }

    if (action === "create" || action === "update") {
      const provider = String(body.provider || "");
      if (!PROVIDERS.includes(provider)) return errorResponse(`provider must be one of ${PROVIDERS.join("|")}`, 400);
      const display_name = String(body.display_name || "").trim();
      if (!display_name) return errorResponse("display_name is required", 400);

      const payload: Record<string, unknown> = {
        provider,
        display_name,
        slug: slugify(String(body.slug || display_name)) || crypto.randomUUID().slice(0, 8),
        description: body.description ? String(body.description) : null,
        status: body.status === "disabled" ? "disabled" : "active",
        is_default: Boolean(body.is_default),
        default_region: body.default_region ? String(body.default_region) : null,
        config: body.config && typeof body.config === "object" ? body.config : {},
      };

      // Only overwrite credentials when non-empty values are supplied.
      const incoming = (body.credentials && typeof body.credentials === "object") ? body.credentials : {};
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (typeof v === "string" && v.trim().length) cleaned[k] = v.trim();
      }

      if (action === "create") {
        payload.credentials = cleaned;
        payload.created_by = userId;
        if (payload.is_default) {
          await admin.from("cloud_provider_accounts").update({ is_default: false }).eq("provider", provider);
        }
        const { data, error } = await admin.from("cloud_provider_accounts").insert(payload).select().single();
        if (error) return errorResponse(error.message, 400);
        return jsonResponse({ account: publicRow(data) });
      }

      const id = String(body.id || "");
      if (!id) return errorResponse("id is required", 400);
      const { data: current } = await admin.from("cloud_provider_accounts").select("*").eq("id", id).maybeSingle();
      if (!current) return errorResponse("Account not found", 404);
      payload.credentials = { ...(current.credentials ?? {}), ...cleaned };
      if (Array.isArray(body.clear_credential_keys)) {
        for (const k of body.clear_credential_keys) delete (payload.credentials as Record<string, string>)[String(k)];
      }
      if (payload.is_default) {
        await admin.from("cloud_provider_accounts").update({ is_default: false }).eq("provider", provider).neq("id", id);
      }
      const { data, error } = await admin.from("cloud_provider_accounts").update(payload).eq("id", id).select().single();
      if (error) return errorResponse(error.message, 400);
      return jsonResponse({ account: publicRow(data) });
    }

    if (action === "list_subnets") {
      const id = String(body.id || "");
      if (!id) return errorResponse("id is required", 400);
      const { data: row } = await admin.from("cloud_provider_accounts").select("*").eq("id", id).maybeSingle();
      if (!row) return errorResponse("Account not found", 404);
      if (row.provider !== "azure") return errorResponse("Subnet discovery is only available for Azure accounts", 400);
      try {
        const runtime = azureRuntimeFromAccount(row as any);
        const networks = await listAzureNetworks(runtime);
        return jsonResponse(networks);
      } catch (e) {
        return errorResponse(e instanceof Error ? e.message : "Failed to list subnets", 400);
      }
    }

    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return errorResponse("id is required", 400);
      const { count } = await admin
        .from("access_templates").select("id", { count: "exact", head: true }).eq("provider_account_id", id);
      if ((count ?? 0) > 0) {
        return errorResponse(`This account is used by ${count} access template(s). Reassign them first.`, 409);
      }
      const { error } = await admin.from("cloud_provider_accounts").delete().eq("id", id);
      if (error) return errorResponse(error.message, 400);
      return jsonResponse({ success: true });
    }

    if (action === "test") {
      const id = body.id ? String(body.id) : null;
      let provider = String(body.provider || "");
      let config = (body.config && typeof body.config === "object") ? body.config : {};
      let credentials: Record<string, string> = {};

      if (id) {
        const { data: row } = await admin.from("cloud_provider_accounts").select("*").eq("id", id).maybeSingle();
        if (!row) return errorResponse("Account not found", 404);
        provider = row.provider;
        config = { ...(row.config ?? {}), ...config };
        credentials = { ...(row.credentials ?? {}) };
      }
      if (body.credentials && typeof body.credentials === "object") {
        for (const [k, v] of Object.entries(body.credentials)) {
          if (typeof v === "string" && v.trim().length) credentials[k] = v.trim();
        }
      }
      if (!PROVIDERS.includes(provider)) return errorResponse("provider is required", 400);

      const result = await testAccount({ provider, config, credentials });
      if (id) {
        await admin.from("cloud_provider_accounts").update({
          last_test_status: result.ok ? "ok" : "failed",
          last_test_message: result.message.slice(0, 500),
          last_tested_at: new Date().toISOString(),
        }).eq("id", id);
      }
      return jsonResponse({ result });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (e) {
    console.error("cloud-provider-accounts error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
