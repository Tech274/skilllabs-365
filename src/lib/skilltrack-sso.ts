/**
 * ST-54: client half of SkillTrack → SkillHub single sign-on.
 *
 * SkillTrack opens https://skillhub365.co.in/sso/skilltrack#token=<jwt>.
 * The token rides in the URL fragment so it never reaches a server log or a
 * Referer header. We strip it from the address bar first, then:
 *   1. POST it to the `skilltrack-sso-exchange` edge function
 *   2. exchange the returned magic-link token_hash with verifyOtp → session
 * Any failure falls back to /login with the email prefilled (today's flow).
 */
import { HANDOFF_STORAGE_KEY } from "@/lib/skilltrack-handoff";

export const SSO_PATH = "/sso/skilltrack";
export const SSO_FUNCTION = "skilltrack-sso-exchange";

/** Read `token` from a `#token=…` fragment. Returns null when absent/garbled. */
export function readSsoTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get("token")?.trim() ?? "";
  // compact JWS: three base64url parts
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export type SsoOutcome =
  | { ok: true }
  | { ok: false; error: string; email?: string };

type InvokeResult = { data: unknown; error: { context?: unknown; message?: string } | null };

/** Minimal surface of the Supabase client we use (keeps tests simple). */
export type SsoSupabase = {
  functions: { invoke: (name: string, opts: { body: unknown }) => Promise<InvokeResult> };
  auth: {
    verifyOtp: (p: { token_hash: string; type: "magiclink" }) => Promise<{ error: unknown | null }>;
  };
};

async function errorBody(err: { context?: unknown } | null): Promise<{ error?: string; email?: string }> {
  const ctx = err?.context as { json?: () => Promise<unknown> } | undefined;
  if (ctx && typeof ctx.json === "function") {
    try {
      const b = (await ctx.json()) as { error?: string; email?: string };
      return b ?? {};
    } catch {
      /* fall through */
    }
  }
  return {};
}

export async function exchangeSkillTrackToken(supabase: SsoSupabase, token: string): Promise<SsoOutcome> {
  let res: InvokeResult;
  try {
    res = await supabase.functions.invoke(SSO_FUNCTION, { body: { token } });
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.error) {
    const b = await errorBody(res.error);
    return { ok: false, error: b.error ?? "exchange_failed", email: b.email };
  }
  const d = res.data as { token_hash?: unknown; type?: unknown } | null;
  if (!d || typeof d.token_hash !== "string" || d.type !== "magiclink") {
    return { ok: false, error: "bad_response" };
  }
  try {
    const { error } = await supabase.auth.verifyOtp({ token_hash: d.token_hash, type: "magiclink" });
    if (error) return { ok: false, error: "verify_failed" };
  } catch {
    return { ok: false, error: "verify_failed" };
  }
  return { ok: true };
}

/** Keep the email for /login prefill (Login.tsx reads the handoff store). */
export function rememberEmailForLogin(email: string | undefined, storage: Pick<Storage, "setItem"> = sessionStorage) {
  const e = email?.trim();
  if (!e) return;
  try {
    storage.setItem(
      HANDOFF_STORAGE_KEY,
      JSON.stringify({ handoff: "skilltrack", email: e, capturedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}
