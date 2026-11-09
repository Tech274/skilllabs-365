// ST-54: exchange a SkillTrack-signed SSO token for a SkillHub session.
//
// POST { token } → 200 { token_hash, type: "magiclink", email }
// The SPA (/sso/skilltrack) then calls supabase.auth.verifyOtp({ token_hash, type })
// which stores the session the normal way. No email is sent.
//
// HELD until Atlas GO: needs secret SKILLTRACK_SSO_SIGNING_KEY and the held
// migration docs/st-54/HELD-20261109-skilltrack-sso-jti.sql. Without either,
// this returns 503 and the SPA falls back to /login (today's behaviour).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runBestEffort, ssoCorsGate, ssoCorsHeaders } from "../_shared/skilltrack-sso-cors.ts";
import { exchangeSkillTrackSso, type JtiClaim } from "../_shared/skilltrack-sso-exchange.ts";

const PRIVILEGED_ROLES = ["admin", "super_admin", "content_admin", "instructor"];

// Supabase edge runtime global; absent in plain Deno.
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  // Only https://skillhub365.co.in, enforced here; does NOT use ALLOWED_ORIGINS.
  const gated = ssoCorsGate(req);
  if (gated) return gated;
  const cors = ssoCorsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let token: unknown = null;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    return json({ error: "invalid_token", reason: "malformed" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const result = await exchangeSkillTrackSso(token, {
    secret: Deno.env.get("SKILLTRACK_SSO_SIGNING_KEY"),
    claimJti: async (jti, exp, sub): Promise<JtiClaim> => {
      const { error } = await admin.from("skilltrack_sso_jti").insert({
        jti,
        skilltrack_user_id: sub,
        expires_at: new Date(exp * 1000).toISOString(),
      });
      if (!error) return "claimed";
      if (error.code === "23505") return "replay";
      console.error("[skilltrack-sso] jti store unavailable", error.code);
      return "unavailable";
    },
    findUserIdsByEmail: async (email) => {
      const { data, error } = await admin.from("profiles").select("user_id").ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(3);
      if (error) return null;
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    },
    getAuthEmail: async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      if (!data.user.email_confirmed_at) return null;
      return data.user.email ?? null;
    },
    isPrivileged: async (userId) => {
      const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
      if (error) return true; // fail closed
      return (data ?? []).some((r: { role: string }) => PRIVILEGED_ROLES.includes(r.role));
    },
    generateMagicLinkHash: async (email) => {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error) return null;
      return data?.properties?.hashed_token ?? null;
    },
  });

  if (!result.ok) console.warn("[skilltrack-sso] refused", result.body.error, result.body.reason ?? "");

  // Opportunistic cleanup of expired jti rows. Best effort: never fails or
  // delays the exchange (runs after the result is computed, kept alive by
  // waitUntil when available). No scheduled job needed.
  runBestEffort(
    async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from("skilltrack_sso_jti").delete().lt("expires_at", cutoff);
      if (error) throw error;
    },
    typeof EdgeRuntime !== "undefined" ? EdgeRuntime?.waitUntil?.bind(EdgeRuntime) : undefined,
    (e) => console.warn("[skilltrack-sso] jti cleanup skipped", (e as { code?: string })?.code ?? ""),
  );

  return json(result.body, result.status);
});
