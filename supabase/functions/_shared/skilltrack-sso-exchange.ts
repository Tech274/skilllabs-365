// ST-54: SkillTrack → SkillHub SSO exchange, as pure logic with injected I/O.
// The edge function (skilltrack-sso-exchange/index.ts) wires these deps to
// Supabase; tests wire fakes. No Deno or npm imports here.

import { statusForVerifyError, verifySkillTrackSsoToken } from "./skilltrack-sso-token.ts";

export type JtiClaim = "claimed" | "replay" | "unavailable";

export type SsoExchangeDeps = {
  /** SKILLTRACK_SSO_SIGNING_KEY; null/empty = feature off. */
  secret: string | null | undefined;
  nowSeconds?: number;
  /** Insert jti once. "unavailable" (e.g. table missing) fails closed. */
  claimJti: (jti: string, expiresAtSeconds: number, sub: string) => Promise<JtiClaim>;
  /** SkillHub user ids whose profile email equals `email` (lower-cased). */
  findUserIdsByEmail: (email: string) => Promise<string[] | null>;
  /** Canonical auth.users email for the id, or null. */
  getAuthEmail: (userId: string) => Promise<string | null>;
  /** Admin / instructor / super_admin / content_admin: never signed in by SSO. */
  isPrivileged: (userId: string) => Promise<boolean>;
  /** Magic-link token_hash for the user (no email is sent), or null. */
  generateMagicLinkHash: (email: string) => Promise<string | null>;
};

export type SsoExchangeError =
  | "not_configured"
  | "invalid_token"
  | "replayed"
  | "replay_store_unavailable"
  | "no_account"
  | "ambiguous_account"
  | "privileged_account"
  | "session_unavailable";

export type SsoExchangeResult =
  | { ok: true; status: 200; body: { token_hash: string; type: "magiclink"; email: string } }
  | { ok: false; status: number; body: { error: SsoExchangeError; reason?: string; email?: string } };

function fail(
  status: number,
  error: SsoExchangeError,
  extra: { reason?: string; email?: string } = {},
): SsoExchangeResult {
  return { ok: false, status, body: { error, ...extra } };
}

/**
 * Order matters:
 *  1. verify signature + claims (no DB touched for a bad token)
 *  2. burn the jti (replay protection) before any user lookup
 *  3. match exactly one non-privileged SkillHub user by verified email
 *  4. mint a single-use magic-link token_hash the browser exchanges for a session
 * `email` is only echoed back on no_account so the client can prefill /login or /signup.
 */
export async function exchangeSkillTrackSso(token: unknown, deps: SsoExchangeDeps): Promise<SsoExchangeResult> {
  const verified = await verifySkillTrackSsoToken(typeof token === "string" ? token : "", deps.secret, deps.nowSeconds);
  if (!verified.ok) {
    if (verified.error === "not_configured") return fail(statusForVerifyError(verified.error), "not_configured");
    return fail(401, "invalid_token", { reason: verified.error });
  }
  const { claims } = verified;

  const claim = await deps.claimJti(claims.jti, claims.exp, claims.sub);
  if (claim === "replay") return fail(409, "replayed");
  if (claim !== "claimed") return fail(503, "replay_store_unavailable");

  const ids = await deps.findUserIdsByEmail(claims.email);
  if (ids === null) return fail(503, "session_unavailable", { reason: "lookup_failed" });
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail(404, "no_account", { email: claims.email });
  if (unique.length > 1) return fail(409, "ambiguous_account");
  const userId = unique[0];

  const authEmail = (await deps.getAuthEmail(userId))?.trim().toLowerCase() ?? null;
  // Profile email can drift from auth email; only the auth email is trusted.
  if (!authEmail || authEmail !== claims.email) return fail(404, "no_account", { email: claims.email });

  if (await deps.isPrivileged(userId)) return fail(403, "privileged_account");

  const hash = await deps.generateMagicLinkHash(authEmail);
  if (!hash) return fail(503, "session_unavailable", { reason: "link_failed" });

  return { ok: true, status: 200, body: { token_hash: hash, type: "magiclink", email: authEmail } };
}
