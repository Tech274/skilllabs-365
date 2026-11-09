import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifySkillTrackSsoToken } from "./skilltrack-sso-token.ts";

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SECRET = "st54-deno-fixture-key-not-a-real-secret-012345";
const NOW = 1_794_000_000;

async function sign(claims: Record<string, unknown>, secret = SECRET) {
  const h = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = b64url(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${h}.${p}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`))))}`;
}
const claims = (o: Record<string, unknown> = {}) => ({
  iss: "https://skilltrack.co.in", aud: "https://skillhub365.co.in", sub: "u", email: "a@b.co",
  email_verified: true, jti: "j", iat: NOW, exp: NOW + 60, ...o,
});

Deno.test("SSO token verifies under Deno WebCrypto", async () => {
  const r = await verifySkillTrackSsoToken(await sign(claims()), SECRET, NOW);
  assertEquals(r.ok, true);
});

Deno.test("SSO token rejects wrong key, wrong audience and expiry", async () => {
  assertEquals(await verifySkillTrackSsoToken(await sign(claims(), SECRET + "x"), SECRET, NOW), { ok: false, error: "bad_signature" });
  assertEquals(await verifySkillTrackSsoToken(await sign(claims({ aud: "x" })), SECRET, NOW), { ok: false, error: "bad_audience" });
  assertEquals(await verifySkillTrackSsoToken(await sign(claims()), SECRET, NOW + 200), { ok: false, error: "expired" });
  assertEquals(await verifySkillTrackSsoToken(await sign(claims()), undefined, NOW), { ok: false, error: "not_configured" });
});
