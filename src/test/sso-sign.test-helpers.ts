// Test-only HS256 signer that mirrors SkillTrack's src/lib/skillhub-sso.ts.
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

export const TEST_SECRET = "st54-test-fixture-key-not-a-real-secret-0123456789";

export async function signTestToken(
  claims: Record<string, unknown>,
  secret = TEST_SECRET,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
  const h = b64urlJson(header);
  const p = b64urlJson(claims);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

export const NOW = 1_794_000_000;

export function goodClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://skilltrack.co.in",
    aud: "https://skillhub365.co.in",
    sub: "st-user-1",
    email: "Ada@Example.com",
    email_verified: true,
    jti: "jti-1",
    iat: NOW,
    exp: NOW + 60,
    ...over,
  };
}
