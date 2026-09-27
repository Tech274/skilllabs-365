# Vercel hosting prep (SCRUM-23)

Status: **repo-side prep only.** Nothing here has been cut over. The live SPA
stays on its current host until Vivek gives an explicit GO. Azure Static Web
Apps is a later option and is not covered here.

## What is in the repo

| File | Purpose |
| --- | --- |
| `vercel.json` | Vite build → `dist/`, SPA fallback, production security headers, immutable cache for `/assets/*`. **Generated. Do not hand-edit.** |
| `scripts/security-headers.ts` | Single source of truth for CSP / HSTS / frame-ancestors. `vercelConfig()` renders `vercel.json`. `headersFile()` renders `public/_headers`. |
| `scripts/generate-headers.ts` | Runs on `prebuild`. Rewrites both files. |
| `src/test/hosting-config.test.ts` | CI fails if either committed file drifts from the generator, or if the SPA fallback or headers regress. |

After changing `scripts/security-headers.ts`, run `npm run headers:generate` and
commit **both** `public/_headers` and `vercel.json`. Vercel reads `vercel.json`
*before* the build runs, so only the committed file counts.

### SPA fallback
`/((?!assets/).*)` → `/index.html`. Vercel serves real files from `dist/`
first. Every other path, e.g. `/lab/<id>` or `/admin/cloud-reports`, gets the
app shell. Missing hashed assets under `/assets/` return a real 404 instead of
HTML-as-JS, so a stale tab fails loudly after a deploy.

### Headers
Same production set as `public/_headers`: CSP (Supabase, both Guacamole hosts,
cloud consoles, Google Fonts), `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP.

## Vercel project settings

- Framework preset: **Vite** (also pinned in `vercel.json`)
- Install: `npm ci` · Build: `npm run build` · Output: `dist`
- Node.js: **20.x** (same as CI)
- Root directory: repo root

### Environment variables (Production + Preview)

| Name | Value | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Public. Baked into the bundle at build time. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon / publishable key | Public anon key only. **Never** the service-role key. |
| `VITE_SUPABASE_PROJECT_ID` | `<project-ref>` | Public. |
| `CSP_EXTRA_ORIGINS` | *(optional)* comma-separated origins | Only affects the build-time CSP `<meta>`. The CSP **header** comes from the committed `vercel.json`, and browsers enforce both. For an extra origin, regenerate `vercel.json` locally with the variable set and commit it. |

Values match the current `.env`. Server secrets (Azure/AWS/Guacamole/AI keys)
live in Supabase edge-function secrets and are **not** needed on Vercel.

## Cutover checklist (each step needs Vivek's GO. Not done.)

1. **Preview deploy.** Import `Tech274/skilllabs-365` in the Vercel team, set the env vars above, deploy `main` to a preview URL.
2. **Edge CORS for the preview origin.** Edge functions only answer allowlisted origins (`_shared/auth.ts` → `isAllowedOrigin`). A `*.vercel.app` preview needs its exact origin in the `ALLOWED_ORIGINS` Supabase secret (comma separated). No code change is required. After DNS cutover the origin stays `https://skillhub365.co.in`, which is already served today.
3. **Supabase Auth URLs.** Add the preview URL to Auth → URL configuration → Redirect URLs, so password reset and OAuth return correctly. Leave Site URL as the production domain.
4. **Vercel toolbar.** Preview deployments inject `vercel.live` scripts, which the strict CSP blocks. Disable the toolbar for the project, or accept the console noise on previews. Production is unaffected.
5. **Smoke on preview.** Log in (admin + learner), check deep-link reload on `/lab/<id>`, Launch → Connect (Guac iframe on both hosts), Leave → Start, and `/reports`.
6. **DNS cutover.** Add `skillhub365.co.in` (and `www` if used) to the Vercel project, then switch DNS per Vercel's instructions. Keep the old host warm for rollback. **Explicit GO required.**
7. **Post-cutover.** Re-run the smoke on the production domain. Only then retire the old host.

Rollback: point DNS back to the previous host. No database or edge-function
changes are part of this cutover.
