// Shared auth helpers for Lovable Cloud edge functions.
// Functions deploy with verify_jwt = false, so we validate tokens here.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export type AuthCtx = {
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  isServiceRole: boolean;
};

/**
 * Validates the Authorization header. Accepts either a Supabase user JWT or
 * the service-role key (used by cron / internal callers). Returns null when
 * unauthorized so callers can short-circuit with `errorResponse`.
 */
export async function requireUser(req: Request): Promise<AuthCtx | Response> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return errorResponse("Unauthorized", 401);

  const supabase = serviceClient();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token === serviceKey) {
    return { supabase, userId: "00000000-0000-0000-0000-000000000000", email: null, isServiceRole: true };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return errorResponse("Unauthorized", 401);
  return { supabase, userId: data.user.id, email: data.user.email ?? null, isServiceRole: false };
}

/** Require at least one of the given app_role values (or service role). */
export async function requireRole(
  req: Request,
  roles: string[],
): Promise<AuthCtx | Response> {
  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;
  if (ctx.isServiceRole) return ctx;
  for (const role of roles) {
    const { data, error } = await ctx.supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: role,
    });
    if (!error && data === true) return ctx;
  }
  return errorResponse("Forbidden", 403);
}

/** Require platform admin (admin / super_admin / content_admin) or service role. */
export async function requireAdmin(req: Request): Promise<AuthCtx | Response> {
  const ctx = await requireUser(req);
  if (ctx instanceof Response) return ctx;
  if (ctx.isServiceRole) return ctx;
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (data === true) return ctx;
  return errorResponse("Forbidden: admin only", 403);
}

/** Require that the caller owns the row, OR is a platform admin / service role. */
export async function requireOwnerOrAdmin(
  ctx: AuthCtx,
  ownerUserId: string | null | undefined,
): Promise<Response | null> {
  if (ctx.isServiceRole) return null;
  if (ownerUserId && ownerUserId === ctx.userId) return null;
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (data === true) return null;
  return errorResponse("Forbidden", 403);
}
