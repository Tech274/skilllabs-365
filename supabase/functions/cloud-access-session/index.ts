import { corsHeaders, requireUser, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { createSession as awsCreate, revokeSession as awsRevoke } from "../_shared/cloud-providers/aws.ts";
import { createSession as azureCreate, revokeSession as azureRevoke } from "../_shared/cloud-providers/azure.ts";
import { createSession as gcpCreate, revokeSession as gcpRevoke } from "../_shared/cloud-providers/gcp.ts";

type Provider = "aws" | "azure" | "gcp";

interface ProviderResult {
  federated_url: string;
  provider_session_ref: string | null;
  scope: Record<string, unknown>;
}

interface SessionRow {
  id: string;
  user_id: string;
  template_id: string;
  provider: Provider;
  status: string;
  expires_at: string;
  refresh_count: number;
  provider_session_ref: string | null;
  federated_url: string | null;
  parent_session_id: string | null;
}

async function logEvent(supabase: any, session_id: string, event_type: string, actor_id: string | null, payload: Record<string, unknown> = {}) {
  await supabase.from("access_session_events").insert({ session_id, event_type, actor_id, payload });
}

interface DispatchCtx {
  userId: string;
  templateConfig: Record<string, unknown>;
  region: string | null;
  durationMinutes: number;
  azureObjectId?: string | null;
  azureDefaults?: Record<string, unknown> | null;
}

async function loadProviderExtras(supabase: any, provider: Provider, userId: string): Promise<Partial<DispatchCtx>> {
  if (provider !== "azure") return {};
  const [{ data: profile }, { data: cfg }] = await Promise.all([
    supabase.from("profiles").select("azure_object_id").eq("user_id", userId).maybeSingle(),
    supabase.from("cloud_provider_config").select("config").eq("provider", "azure").maybeSingle(),
  ]);
  return {
    azureObjectId: profile?.azure_object_id ?? null,
    azureDefaults: cfg?.config ?? null,
  };
}

async function dispatchCreate(provider: Provider, ctx: DispatchCtx): Promise<ProviderResult> {
  if (provider === "aws") return awsCreate(ctx);
  if (provider === "azure") return azureCreate(ctx);
  return gcpCreate(ctx);
}

async function dispatchRevoke(provider: Provider, ref: string | null): Promise<void> {
  if (!ref) return;
  if (provider === "aws") return awsRevoke(ref);
  if (provider === "azure") return azureRevoke(ref);
  return gcpRevoke(ref);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const { userId, supabase } = auth;
    if (auth.isServiceRole) return errorResponse("Forbidden: user session required", 403);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }
    const action = String(body.action || "");

    if (action === "create") {
      const template_id = String(body.template_id || "");
      if (!template_id) return errorResponse("template_id required", 400);

      // Entitlement re-check on the server
      const { data: allowed } = await supabase.rpc("user_can_access_template", { _user_id: userId, _template_id: template_id });
      if (!allowed) return errorResponse("Forbidden: not entitled to this template", 403);

      const { data: tpl } = await supabase.from("access_templates").select("*").eq("id", template_id).maybeSingle();
      if (!tpl) return errorResponse("Template not found", 404);
      if (tpl.status !== "published") return errorResponse("Template is not published", 400);

      // One active session per user per template
      const { data: existing } = await supabase
        .from("access_sessions").select("id").eq("user_id", userId).eq("template_id", template_id)
        .in("status", ["created", "active"]).limit(1).maybeSingle();
      if (existing) return errorResponse("You already have an active session for this template", 409);

      const expiresAt = new Date(Date.now() + tpl.session_duration_minutes * 60_000).toISOString();

      // Insert in 'created' state first
      const { data: pending, error: insertErr } = await supabase
        .from("access_sessions").insert({
          user_id: userId,
          template_id,
          provider: tpl.provider,
          region: tpl.region,
          status: "created",
          expires_at: expiresAt,
          scope: tpl.provider_config || {},
        }).select().single();
      if (insertErr || !pending) return errorResponse(`Could not create session: ${insertErr?.message}`, 500);

      await logEvent(supabase, pending.id, "session.created", userId, { template_id });

      try {
        const extras = await loadProviderExtras(supabase, tpl.provider as Provider, userId);
        const result = await dispatchCreate(tpl.provider as Provider, {
          userId: userId,
          templateConfig: tpl.provider_config || {},
          region: tpl.region,
          durationMinutes: tpl.session_duration_minutes,
          ...extras,
        });

        await supabase.from("access_sessions").update({
          status: "active",
          federated_url: result.federated_url,
          provider_session_ref: result.provider_session_ref,
          scope: result.scope,
        }).eq("id", pending.id);

        await logEvent(supabase, pending.id, "credentials.generated", userId, { provider: tpl.provider });

        const { data: full } = await supabase.from("access_sessions").select("*").eq("id", pending.id).maybeSingle();
        return jsonResponse({ session: full });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Provider error";
        await supabase.from("access_sessions").update({ status: "failed", error_message: msg }).eq("id", pending.id);
        await logEvent(supabase, pending.id, "credentials.failed", userId, { error: msg });
        return errorResponse(msg, 502);
      }
    }

    if (action === "refresh") {
      const session_id = String(body.session_id || "");
      if (!session_id) return errorResponse("session_id required", 400);

      const { data: sess } = await supabase.from("access_sessions").select("*").eq("id", session_id).maybeSingle() as { data: SessionRow | null };
      if (!sess) return errorResponse("Session not found", 404);
      if (sess.user_id !== userId) return errorResponse("Forbidden", 403);
      if (sess.status !== "active") return errorResponse("Session is not active", 400);

      const { data: tpl } = await supabase.from("access_templates").select("*").eq("id", sess.template_id).maybeSingle();
      if (!tpl) return errorResponse("Template not found", 404);
      if (!tpl.refresh_allowed) return errorResponse("Refresh is not allowed for this template", 400);

      // Compute new expiry capped by template validity from started_at
      const validityCap = new Date(new Date(sess.expires_at).getTime() - (sess.refresh_count * 60_000)); // soft cap proxy
      const proposed = new Date(Date.now() + tpl.session_duration_minutes * 60_000);
      const newExpiry = proposed < validityCap ? proposed : validityCap < new Date() ? new Date(Date.now() + 60_000) : proposed;

      try {
        await dispatchRevoke(sess.provider, sess.provider_session_ref);
        const extras = await loadProviderExtras(supabase, sess.provider, userId);
        const result = await dispatchCreate(sess.provider, {
          userId: userId,
          templateConfig: tpl.provider_config || {},
          region: tpl.region,
          durationMinutes: tpl.session_duration_minutes,
          ...extras,
        });

        await supabase.from("access_sessions").update({
          federated_url: result.federated_url,
          provider_session_ref: result.provider_session_ref,
          expires_at: newExpiry.toISOString(),
          refresh_count: sess.refresh_count + 1,
          last_activity_at: new Date().toISOString(),
          scope: result.scope,
        }).eq("id", session_id);

        await logEvent(supabase, session_id, "credentials.refreshed", userId, { refresh_count: sess.refresh_count + 1 });
        const { data: full } = await supabase.from("access_sessions").select("*").eq("id", session_id).maybeSingle();
        return jsonResponse({ session: full });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Refresh failed";
        await logEvent(supabase, session_id, "credentials.refresh_failed", userId, { error: msg });
        return errorResponse(msg, 502);
      }
    }

    if (action === "end") {
      const session_id = String(body.session_id || "");
      if (!session_id) return errorResponse("session_id required", 400);
      const { data: sess } = await supabase.from("access_sessions").select("*").eq("id", session_id).maybeSingle() as { data: SessionRow | null };
      if (!sess) return errorResponse("Session not found", 404);
      if (sess.user_id !== userId) {
        const { data: isAdmin } = await supabase.rpc("is_platform_admin", { _user_id: userId });
        if (!isAdmin) return errorResponse("Forbidden", 403);
      }

      try { await dispatchRevoke(sess.provider, sess.provider_session_ref); } catch (e) { console.warn("revoke failed:", e); }

      await supabase.from("access_sessions").update({
        status: "completed",
        ended_at: new Date().toISOString(),
      }).eq("id", session_id);
      await logEvent(supabase, session_id, "session.ended", userId, {});

      return jsonResponse({ success: true });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (err) {
    console.error("cloud-access-session error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
