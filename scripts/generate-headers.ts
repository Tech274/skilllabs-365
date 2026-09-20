/**
 * Writes `public/_headers` from the shared security header definition so the
 * static host serves the same CSP / HSTS / frame-ancestors policy the dev
 * server uses. Run automatically as part of `prebuild`.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { headersFile } from "./security-headers";

const target = resolve(process.cwd(), "public/_headers");
writeFileSync(target, headersFile({ extraOrigins: process.env.CSP_EXTRA_ORIGINS }), "utf8");
console.log(`[headers] wrote ${target}`);
