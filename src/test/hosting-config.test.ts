import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  contentSecurityPolicy,
  headersFile,
  securityHeaders,
  vercelConfig,
  vercelConfigFile,
} from "../../scripts/security-headers";

const root = resolve(__dirname, "../..");

/** Mirrors Vercel's path-to-regexp style for the patterns we emit. */
function vercelSourceMatches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

describe("SCRUM-23 hosting config", () => {
  it("committed vercel.json matches the generator (no drift)", () => {
    const committed = readFileSync(resolve(root, "vercel.json"), "utf8");
    expect(committed).toBe(vercelConfigFile());
  });

  it("committed public/_headers matches the generator (no drift)", () => {
    const committed = readFileSync(resolve(root, "public/_headers"), "utf8");
    expect(committed).toBe(headersFile());
  });

  it("vercel.json builds the Vite app into dist", () => {
    const cfg = vercelConfig();
    expect(cfg.framework).toBe("vite");
    expect(cfg.buildCommand).toBe("npm run build");
    expect(cfg.outputDirectory).toBe("dist");
  });

  it("SPA fallback covers deep links but never hashed assets", () => {
    const [rewrite] = vercelConfig().rewrites;
    expect(rewrite.destination).toBe("/index.html");
    for (const path of ["/", "/labs", "/lab/abc-123", "/admin/cloud-reports", "/reports"]) {
      expect(vercelSourceMatches(rewrite.source, path)).toBe(true);
    }
    expect(vercelSourceMatches(rewrite.source, "/assets/index-abc123.js")).toBe(false);
  });

  it("every route gets the production security headers (same as _headers)", () => {
    const cfg = vercelConfig();
    const all = cfg.headers.find((h) => h.source === "/(.*)");
    expect(all).toBeDefined();
    const got = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    expect(got).toEqual(securityHeaders({ dev: false }));
    expect(got["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(got["Content-Security-Policy"]).toContain("https://guac.skillhub365.co.in");
    expect(got["Content-Security-Policy"]).toContain("https://guac-azure.skillhub365.co.in");
    expect(got["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("hashed assets are cached immutably", () => {
    const assets = vercelConfig().headers.find((h) => h.source === "/assets/(.*)");
    expect(assets?.headers).toEqual([
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ]);
  });
});

describe("index.html document CSP", () => {
  it("carries the live CSP meta, including guac-azure, and not the stale tip", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/);
    const policy = contentSecurityPolicy()
      .split("; ")
      .filter((directive) => !directive.startsWith("frame-ancestors"))
      .join("; ");
    expect(meta?.[1]).toBe(policy);
    expect(meta?.[1]).toContain("https://guac-azure.skillhub365.co.in");
    expect(html).not.toContain('name="skillhub-tip"');
    expect(html).not.toContain("9de17a0a50abc0af37c2b375cf2abfba3ea80510");
  });
});

describe("SCRUM-23 review follow-up", () => {
  it("prebuild does not rewrite vercel.json (would mask the drift test in CI)", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.scripts.prebuild).toContain("--build");
    const gen = readFileSync(resolve(root, "scripts/generate-headers.ts"), "utf8");
    expect(gen).toMatch(/if \(!process\.argv\.includes\("--build"\)\)/);
  });
});
