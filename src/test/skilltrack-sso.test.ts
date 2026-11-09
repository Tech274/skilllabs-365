import { describe, expect, it, vi } from "vitest";
import { verifySkillTrackSsoToken } from "../../supabase/functions/_shared/skilltrack-sso-token.ts";
import {
  exchangeSkillTrackSso,
  type SsoExchangeDeps,
} from "../../supabase/functions/_shared/skilltrack-sso-exchange.ts";
import { exchangeSkillTrackToken, readSsoTokenFromHash, rememberEmailForLogin } from "@/lib/skilltrack-sso";
import { HANDOFF_STORAGE_KEY, shouldLogHandoff } from "@/lib/skilltrack-handoff";
import { NOW, TEST_SECRET, goodClaims, signTestToken } from "./sso-sign.test-helpers";

describe("verifySkillTrackSsoToken (ST-54)", () => {
  it("accepts a good token and normalises the email", async () => {
    const r = await verifySkillTrackSsoToken(await signTestToken(goodClaims()), TEST_SECRET, NOW + 5);
    expect(r).toEqual({ ok: true, claims: expect.objectContaining({ email: "ada@example.com", jti: "jti-1", sub: "st-user-1" }) });
  });

  it("verifies the cross-repo vector signed by SkillTrack's src/lib/skillhub-sso.ts", async () => {
    // Same fixture key + vector as Tech274/sktrck365---Certification-Platform
    // src/lib/skillhub-sso.test.ts. Test-only key, not a real secret.
    const vector =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3NraWxsdHJhY2suY28uaW4iLCJhdWQiOiJodHRwczovL3NraWxsaHViMzY1LmNvLmluIiwic3ViIjoic3QtdXNlci0xIiwiZW1haWwiOiJhZGFAZXhhbXBsZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwianRpIjoidmVjdG9yLWp0aS0xIiwiaWF0IjoxNzk0MDAwMDAwLCJleHAiOjE3OTQwMDAwNjB9.9Y_0CsZmE-LNl8tZmrzZgP0sE13UDbqS53PvC11eCEs";
    const r = await verifySkillTrackSsoToken(vector, "st54-cross-repo-fixture-key-not-a-real-secret", NOW + 10);
    expect(r).toMatchObject({ ok: true, claims: { sub: "st-user-1", email: "ada@example.com", jti: "vector-jti-1" } });
  });

  it("is off when the signing key is missing or too short", async () => {
    const t = await signTestToken(goodClaims());
    expect(await verifySkillTrackSsoToken(t, undefined, NOW)).toEqual({ ok: false, error: "not_configured" });
    expect(await verifySkillTrackSsoToken(t, "short", NOW)).toEqual({ ok: false, error: "not_configured" });
  });

  it.each([
    ["wrong key", async () => signTestToken(goodClaims(), TEST_SECRET + "x"), "bad_signature"],
    ["alg none", async () => signTestToken(goodClaims(), TEST_SECRET, { alg: "none" }), "bad_alg"],
    ["alg HS512", async () => signTestToken(goodClaims(), TEST_SECRET, { alg: "HS512" }), "bad_alg"],
    ["issuer", async () => signTestToken(goodClaims({ iss: "https://evil.example" })), "bad_issuer"],
    ["audience", async () => signTestToken(goodClaims({ aud: "https://skillbridge365.co.in" })), "bad_audience"],
    ["expired", async () => signTestToken(goodClaims({ iat: NOW - 200, exp: NOW - 140 })), "expired"],
    ["future iat", async () => signTestToken(goodClaims({ iat: NOW + 300, exp: NOW + 360 })), "not_yet_valid"],
    ["ttl too long", async () => signTestToken(goodClaims({ exp: NOW + 3600 })), "ttl_too_long"],
    ["no jti", async () => signTestToken(goodClaims({ jti: "" })), "missing_claims"],
    ["no email", async () => signTestToken(goodClaims({ email: undefined })), "missing_claims"],
    ["unverified email", async () => signTestToken(goodClaims({ email_verified: false })), "email_unverified"],
  ])("rejects %s", async (_n, make, error) => {
    expect(await verifySkillTrackSsoToken(await make(), TEST_SECRET, NOW + 5)).toEqual({ ok: false, error });
  });

  it("rejects a tampered payload and garbage", async () => {
    const [h, , s] = (await signTestToken(goodClaims())).split(".");
    const p = btoa(JSON.stringify(goodClaims({ email: "eve@example.com" }))).replace(/=+$/, "");
    expect((await verifySkillTrackSsoToken(`${h}.${p}.${s}`, TEST_SECRET, NOW)).ok).toBe(false);
    expect(await verifySkillTrackSsoToken("a.b", TEST_SECRET, NOW)).toEqual({ ok: false, error: "malformed" });
    expect(await verifySkillTrackSsoToken("a.b.c!", TEST_SECRET, NOW)).toEqual({ ok: false, error: "malformed" });
  });
});

function deps(over: Partial<SsoExchangeDeps> = {}): SsoExchangeDeps {
  const used = new Set<string>();
  return {
    secret: TEST_SECRET,
    nowSeconds: NOW + 1,
    claimJti: vi.fn(async (jti: string) => (used.has(jti) ? "replay" : (used.add(jti), "claimed"))),
    findUserIdsByEmail: vi.fn(async () => ["hub-user-1"]),
    getAuthEmail: vi.fn(async () => "ada@example.com"),
    isPrivileged: vi.fn(async () => false),
    generateMagicLinkHash: vi.fn(async () => "hash-123"),
    ...over,
  };
}

describe("exchangeSkillTrackSso (ST-54)", () => {
  it("mints a magic-link hash for exactly one matching learner", async () => {
    const d = deps();
    const r = await exchangeSkillTrackSso(await signTestToken(goodClaims()), d);
    expect(r).toEqual({ ok: true, status: 200, body: { token_hash: "hash-123", type: "magiclink", email: "ada@example.com" } });
    expect(d.findUserIdsByEmail).toHaveBeenCalledWith("ada@example.com");
    expect(d.generateMagicLinkHash).toHaveBeenCalledWith("ada@example.com");
  });

  it("refuses a replayed token (same jti) the second time", async () => {
    const d = deps();
    const t = await signTestToken(goodClaims());
    expect((await exchangeSkillTrackSso(t, d)).status).toBe(200);
    const again = await exchangeSkillTrackSso(t, d);
    expect(again).toMatchObject({ ok: false, status: 409, body: { error: "replayed" } });
    expect(d.generateMagicLinkHash).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the jti store is missing (migration not applied)", async () => {
    const d = deps({ claimJti: vi.fn(async () => "unavailable" as const) });
    const r = await exchangeSkillTrackSso(await signTestToken(goodClaims()), d);
    expect(r).toMatchObject({ status: 503, body: { error: "replay_store_unavailable" } });
    expect(d.findUserIdsByEmail).not.toHaveBeenCalled();
  });

  it("does not touch the DB for a bad token, and reports 503 when unconfigured", async () => {
    const d = deps();
    const bad = await exchangeSkillTrackSso(await signTestToken(goodClaims(), TEST_SECRET + "x"), d);
    expect(bad).toMatchObject({ status: 401, body: { error: "invalid_token", reason: "bad_signature" } });
    expect(d.claimJti).not.toHaveBeenCalled();
    const off = await exchangeSkillTrackSso(await signTestToken(goodClaims()), deps({ secret: "" }));
    expect(off).toMatchObject({ status: 503, body: { error: "not_configured" } });
    expect((await exchangeSkillTrackSso(42, d)).status).toBe(401);
  });

  it("never creates accounts: no match → 404 no_account with email for signup prefill", async () => {
    const r = await exchangeSkillTrackSso(await signTestToken(goodClaims()), deps({ findUserIdsByEmail: vi.fn(async () => []) }));
    expect(r).toEqual({ ok: false, status: 404, body: { error: "no_account", email: "ada@example.com" } });
  });

  it("refuses ambiguous, mismatched-auth-email and privileged accounts", async () => {
    const t = () => signTestToken(goodClaims({ jti: crypto.randomUUID() }));
    expect((await exchangeSkillTrackSso(await t(), deps({ findUserIdsByEmail: vi.fn(async () => ["a", "b"]) }))).body.error).toBe("ambiguous_account");
    expect((await exchangeSkillTrackSso(await t(), deps({ getAuthEmail: vi.fn(async () => "other@example.com") }))).body.error).toBe("no_account");
    expect((await exchangeSkillTrackSso(await t(), deps({ getAuthEmail: vi.fn(async () => null) }))).body.error).toBe("no_account");
    const priv = deps({ isPrivileged: vi.fn(async () => true) });
    expect(await exchangeSkillTrackSso(await t(), priv)).toMatchObject({ status: 403, body: { error: "privileged_account" } });
    expect(priv.generateMagicLinkHash).not.toHaveBeenCalled();
  });

  it("reports 503 when lookup or link generation fails", async () => {
    const t = () => signTestToken(goodClaims({ jti: crypto.randomUUID() }));
    expect((await exchangeSkillTrackSso(await t(), deps({ findUserIdsByEmail: vi.fn(async () => null) }))).status).toBe(503);
    expect((await exchangeSkillTrackSso(await t(), deps({ generateMagicLinkHash: vi.fn(async () => null) }))).status).toBe(503);
  });
});

describe("SkillHub SSO client (ST-54)", () => {
  it("reads only a well-formed token from the fragment", () => {
    expect(readSsoTokenFromHash("#token=aa.bb.cc")).toBe("aa.bb.cc");
    expect(readSsoTokenFromHash("token=aa.bb.cc&x=1")).toBe("aa.bb.cc");
    expect(readSsoTokenFromHash("")).toBeNull();
    expect(readSsoTokenFromHash("#token=not-a-jwt")).toBeNull();
    expect(readSsoTokenFromHash("#token=a.b.c<script>")).toBeNull();
  });

  it("exchanges the token then verifies the OTP hash", async () => {
    const invoke = vi.fn(async () => ({ data: { token_hash: "h", type: "magiclink" }, error: null }));
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const out = await exchangeSkillTrackToken({ functions: { invoke }, auth: { verifyOtp } }, "a.b.c");
    expect(out).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("skilltrack-sso-exchange", { body: { token: "a.b.c" } });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "magiclink" });
  });

  it("surfaces the server error code and email, and never calls verifyOtp on failure", async () => {
    const invoke = vi.fn(async () => ({
      data: null,
      error: { context: { json: async () => ({ error: "no_account", email: "ada@example.com" }) } },
    }));
    const verifyOtp = vi.fn();
    const out = await exchangeSkillTrackToken({ functions: { invoke }, auth: { verifyOtp } }, "a.b.c");
    expect(out).toEqual({ ok: false, error: "no_account", email: "ada@example.com" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("treats a verifyOtp error or odd response as a failure", async () => {
    const verifyOtp = vi.fn(async () => ({ error: new Error("expired") }));
    const ok = vi.fn(async () => ({ data: { token_hash: "h", type: "magiclink" }, error: null }));
    expect(await exchangeSkillTrackToken({ functions: { invoke: ok }, auth: { verifyOtp } }, "a.b.c")).toEqual({ ok: false, error: "verify_failed" });
    const odd = vi.fn(async () => ({ data: { session: "x" }, error: null }));
    expect(await exchangeSkillTrackToken({ functions: { invoke: odd }, auth: { verifyOtp } }, "a.b.c")).toEqual({ ok: false, error: "bad_response" });
  });

  it("remembers the email for /login prefill", () => {
    const store = new Map<string, string>();
    rememberEmailForLogin("ada@example.com", { setItem: (k, v) => void store.set(k, v) });
    expect(JSON.parse(store.get(HANDOFF_STORAGE_KEY)!)).toMatchObject({ handoff: "skilltrack", email: "ada@example.com" });
    rememberEmailForLogin(undefined, { setItem: (k, v) => void store.set(k + "x", v) });
    expect(store.size).toBe(1);
  });
});

describe("handoff soft-log (ST-54 400 fix)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("never logs anonymously", () => {
    expect(shouldLogHandoff("2026-11-09T00:00:00Z", null, mem())).toBe(false);
  });

  it("logs a given capture once per user", () => {
    const s = mem();
    expect(shouldLogHandoff("t1", "u1", s)).toBe(true);
    expect(shouldLogHandoff("t1", "u1", s)).toBe(false);
    expect(shouldLogHandoff("t2", "u1", s)).toBe(true);
  });
});
