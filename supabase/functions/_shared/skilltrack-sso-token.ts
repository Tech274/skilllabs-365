// ST-54: verify the short-lived SSO token SkillTrack signs for SkillHub.
//
// Pure WebCrypto, no Deno or npm imports, so the same file runs in the edge
// function (Deno) and in Vitest (Node). Format: compact JWS, HS256.
//
// Required claims:
//   iss = "https://skilltrack.co.in"     aud = "https://skillhub365.co.in"
//   sub = SkillTrack user id             email = verified SkillTrack email
//   jti = random id (single use)         iat / exp, exp - iat <= 120 s
//   email_verified = true

export const SSO_ISSUER = "https://skilltrack.co.in";
export const SSO_AUDIENCE = "https://skillhub365.co.in";
/** Longest lifetime we accept, whatever the token says. */
export const SSO_MAX_TTL_SECONDS = 120;
/** Clock skew allowed on iat / exp. */
export const SSO_CLOCK_SKEW_SECONDS = 30;
/** Signing key must be at least this long (bytes of UTF-8). */
export const SSO_MIN_SECRET_LENGTH = 32;

export type SsoClaims = {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: true;
  jti: string;
  iat: number;
  exp: number;
};

export type SsoVerifyError =
  | "not_configured"
  | "malformed"
  | "bad_alg"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "expired"
  | "not_yet_valid"
  | "ttl_too_long"
  | "missing_claims"
  | "email_unverified";

export type SsoVerifyResult =
  | { ok: true; claims: SsoClaims }
  | { ok: false; error: SsoVerifyError };

function b64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function decodeJson(s: string): Record<string, unknown> | null {
  const bytes = b64urlToBytes(s);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Verify signature and claims. Never throws. `nowSeconds` is injectable for tests.
 * Signature is checked with crypto.subtle.verify (constant-time).
 */
export async function verifySkillTrackSsoToken(
  token: string,
  secret: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SsoVerifyResult> {
  if (!secret || new TextEncoder().encode(secret).length < SSO_MIN_SECRET_LENGTH) {
    return { ok: false, error: "not_configured" };
  }
  if (typeof token !== "string" || token.length > 4096) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, error: "malformed" };
  const [h, p, s] = parts;

  const header = decodeJson(h);
  if (!header) return { ok: false, error: "malformed" };
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    return { ok: false, error: "bad_alg" };
  }

  const sig = b64urlToBytes(s);
  if (!sig) return { ok: false, error: "malformed" };
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, sig.buffer as ArrayBuffer, new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return { ok: false, error: "bad_signature" };

  const c = decodeJson(p);
  if (!c) return { ok: false, error: "malformed" };
  if (c.iss !== SSO_ISSUER) return { ok: false, error: "bad_issuer" };
  if (c.aud !== SSO_AUDIENCE) return { ok: false, error: "bad_audience" };
  if (!isNonEmptyString(c.sub) || !isNonEmptyString(c.email) || !isNonEmptyString(c.jti) || !isInt(c.iat) || !isInt(c.exp)) {
    return { ok: false, error: "missing_claims" };
  }
  if (c.email_verified !== true) return { ok: false, error: "email_unverified" };
  if (c.exp - c.iat > SSO_MAX_TTL_SECONDS || c.exp <= c.iat) return { ok: false, error: "ttl_too_long" };
  if (c.iat > nowSeconds + SSO_CLOCK_SKEW_SECONDS) return { ok: false, error: "not_yet_valid" };
  if (c.exp + SSO_CLOCK_SKEW_SECONDS < nowSeconds) return { ok: false, error: "expired" };

  return {
    ok: true,
    claims: {
      iss: c.iss as string,
      aud: c.aud as string,
      sub: (c.sub as string).trim(),
      email: (c.email as string).trim().toLowerCase(),
      email_verified: true,
      jti: (c.jti as string).trim(),
      iat: c.iat,
      exp: c.exp,
    },
  };
}

/** HTTP status for each verify error. 503 = server not set up, 401 = bad token. */
export function statusForVerifyError(e: SsoVerifyError): number {
  return e === "not_configured" ? 503 : 401;
}
