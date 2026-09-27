/**
 * Writes the static-host header/config files from the shared security header
 * definition so every host serves the same CSP / HSTS / frame-ancestors policy
 * the dev server uses. Run automatically as part of `prebuild`.
 *
 *   - `public/_headers` — Netlify / Cloudflare Pages / Lovable syntax
 *   - `vercel.json`     — Vercel headers + SPA rewrites (SCRUM-23)
 *
 * Vercel reads `vercel.json` BEFORE the build runs, so the committed file is
 * what production uses. A test (`src/test/hosting-config.test.ts`) fails CI if
 * it drifts from `scripts/security-headers.ts`.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { headersFile, vercelConfigFile } from "./security-headers";

const opts = { extraOrigins: process.env.CSP_EXTRA_ORIGINS };

const headersTarget = resolve(process.cwd(), "public/_headers");
writeFileSync(headersTarget, headersFile(opts), "utf8");
console.log(`[headers] wrote ${headersTarget}`);

const vercelTarget = resolve(process.cwd(), "vercel.json");
writeFileSync(vercelTarget, vercelConfigFile(opts), "utf8");
console.log(`[headers] wrote ${vercelTarget}`);
