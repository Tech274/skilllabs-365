import { describe, expect, it, vi } from "vitest";
import {
  isSsoOriginAllowed,
  runBestEffort,
  SSO_ALLOWED_ORIGINS,
  ssoCorsGate,
  ssoCorsHeaders,
} from "../../supabase/functions/_shared/skilltrack-sso-cors.ts";

const req = (method: string, origin?: string) => ({
  method,
  headers: new Headers(origin === undefined ? {} : { origin }),
});

describe("skilltrack-sso-exchange CORS (ST-54)", () => {
  it("allowlist is exactly https://skillhub365.co.in", () => {
    expect([...SSO_ALLOWED_ORIGINS]).toEqual(["https://skillhub365.co.in"]);
    expect(Object.isFrozen(SSO_ALLOWED_ORIGINS)).toBe(true);
  });

  it.each([
    "http://skillhub365.co.in",
    "https://www.skillhub365.co.in",
    "https://evil.skillhub365.co.in",
    "https://skillhub365.co.in.evil.com",
    "https://skillhub365.co.in/",
    "https://skilltrack.co.in",
    "https://abc.lovable.app",
    "https://x.lovableproject.com",
    "http://localhost:5173",
    "null",
    "",
  ])("rejects %s with 403 and no ACAO", async (origin) => {
    expect(isSsoOriginAllowed(origin)).toBe(false);
    for (const m of ["POST", "OPTIONS"]) {
      const res = ssoCorsGate(req(m, origin))!;
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(await res.json()).toEqual({ error: "origin_not_allowed" });
    }
  });

  it("rejects a request with no Origin header", () => {
    const res = ssoCorsGate(req("POST"))!;
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight from the allowed origin with 204 + headers", () => {
    const res = ssoCorsGate(req("OPTIONS", "https://skillhub365.co.in"))!;
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://skillhub365.co.in");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("lets a POST from the allowed origin through and echoes only that origin", () => {
    expect(ssoCorsGate(req("POST", "https://skillhub365.co.in"))).toBeNull();
    expect(ssoCorsHeaders("https://skillhub365.co.in")["Access-Control-Allow-Origin"]).toBe("https://skillhub365.co.in");
    expect(ssoCorsHeaders("https://evil.example")).toEqual({ Vary: "Origin" });
  });

  it("never reads ALLOWED_ORIGINS", () => {
    const env = { get: vi.fn() };
    (globalThis as { Deno?: unknown }).Deno = { env };
    try {
      ssoCorsGate(req("POST", "https://labs.example.com"));
      ssoCorsGate(req("POST", "https://skillhub365.co.in"));
      expect(env.get).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { Deno?: unknown }).Deno;
    }
  });
});

describe("runBestEffort (opportunistic jti cleanup)", () => {
  it("swallows rejections and sync throws, reporting them", async () => {
    const onError = vi.fn();
    expect(() => runBestEffort(() => Promise.reject(new Error("table missing")), undefined, onError)).not.toThrow();
    expect(() =>
      runBestEffort(() => {
        throw new Error("boom");
      }, undefined, onError),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("does not block the caller on a slow task and hands it to waitUntil", () => {
    const waitUntil = vi.fn();
    const t0 = Date.now();
    runBestEffort(() => new Promise(() => {}), waitUntil);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("survives a throwing waitUntil", () => {
    expect(() =>
      runBestEffort(async () => {}, () => {
        throw new Error("no runtime");
      }),
    ).not.toThrow();
  });
});
