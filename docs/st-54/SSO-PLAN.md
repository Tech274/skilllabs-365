# ST-54 — Single sign-on from SkillTrack into SkillHub Labs

Status: **PR only, HELD.** Atlas gave an Eng PASS on the design on 9 Nov 2026. Nothing here is deployed, published or applied.
Two PRs, cross-linked:

- SkillTrack (signing + redirect): `Tech274/sktrck365---Certification-Platform`, branch `feat/st-54-skillhub-sso`
- SkillHub (exchange + landing page + "400" fix): `Tech274/skilllabs-365`, branch `feat/st-54-skilltrack-sso`

The same plan file is in both repos at `docs/st-54/SSO-PLAN.md`.

## 1. Problem today (from PR #56, `docs/st-54/README.md`)

- Nav **Labs** and `/labs` send users to `https://skillhub365.co.in/?handoff=skilltrack[&email=…]`.
  These are context params only; no credential.
- SkillHub's `SkillTrackHandoffCapture` stores the params, sends anonymous users to `/login`
  → **second sign-in** (SkillHub is a separate Supabase project, `ubitkkcukilxzybodwcc`,
  with its own users).
- On first paint, before auth had loaded and for anonymous visitors, it inserted into
  `skilltrack_handoff_events`. That table's insert policy is `authenticated` only, so every
  anonymous insert failed in the console. That is the most likely source of the reported "400"
  (not reproduced against prod, because the rules forbid writing probes there). The effect also
  re-ran on every route or session change and re-posted the same row.

## 2. Design

```
SkillTrack (browser)          SkillTrack server            SkillHub SPA                 SkillHub edge fn
  click Labs (signed in) ──▶ createSkillHubSsoLink()
  open blank tab              getUser(); require verified
                              email; sign HS256 JWT (60 s)
  tab → skillhub365.co.in/sso/skilltrack#token=<jwt>  ──▶  strip #token from URL
                                                            POST {token} ───────────▶ verify sig + claims
                                                                                      burn jti (single use)
                                                                                      match 1 learner by email
                                                                                      generateLink(magiclink)
                                                            ◀─── {token_hash} ──────
                                                            verifyOtp(token_hash) → session stored
                                                            navigate "/" → role dashboard
```

### Token (SkillTrack `src/lib/skillhub-sso.ts`)
- Compact JWS, **HS256**, shared key `SKILLTRACK_SSO_SIGNING_KEY` (≥ 32 bytes).
- Claims: `iss=https://skilltrack.co.in`, `aud=https://skillhub365.co.in`, `sub` (SkillTrack
  user id), `email` (lower-cased), `email_verified=true`, `jti` (random UUID), `iat`, `exp=iat+60`.
- Signed **server-side only** in a `createServerFn` behind `requireSupabaseAuth`
  (`src/lib/skillhub-sso.functions.ts`). The server re-reads the user with `auth.getUser()` and
  only signs if `email_confirmed_at` is set.
- Sent in the URL **fragment** (`#token=`), so it never reaches a server, an access log or a Referer.
- ES256 (SkillTrack keeps the private key, SkillHub holds only the public key) is a drop-in
  upgrade later if we don't want a shared secret. HS256 was chosen for v1 because both runtimes
  have it in WebCrypto with no new dependency.

### Exchange (SkillHub `supabase/functions/skilltrack-sso-exchange`)
Logic lives in `_shared/skilltrack-sso-exchange.ts` (pure, unit-tested) and runs in this order:
1. **Verify** signature (constant-time `crypto.subtle.verify`), `alg=HS256` only (rejects `none` and
   others), exact `iss`/`aud`, `exp - iat ≤ 120 s`, ±30 s clock skew, `email_verified=true`.
   A bad token never touches the DB.
2. **Replay protection:** insert `jti` into `skilltrack_sso_jti` (primary key). A duplicate
   (`23505`) returns 409 `replayed`. If the table is missing or errors, it returns 503 and
   **fails closed**.
3. **User matching:** `profiles.email` equal (case-insensitive) to the token email must give
   **exactly one** user. Then `auth.users.email` for that id must equal the token email and be
   confirmed. Zero matches return 404 `no_account`; more than one returns 409 `ambiguous_account`.
4. **Learners only (v1):** users with `admin`, `super_admin`, `content_admin` or `instructor` get
   403 `privileged_account` and must sign in normally. On a role-lookup error it fails closed.
5. **Session:** `auth.admin.generateLink({type:"magiclink"})` gives a single-use `hashed_token`
   (no email is sent). The browser calls `supabase.auth.verifyOtp({token_hash, type:"magiclink"})`,
   so supabase-js stores the session exactly as a normal sign-in would.
6. **Opportunistic jti cleanup:** after the result is computed, each call deletes
   `skilltrack_sso_jti` rows with `expires_at < now() - 1 day`. The delete is best effort: it is
   handed to `EdgeRuntime.waitUntil` (or fired and forgotten), and errors are swallowed and logged
   by code only. It never fails or delays the exchange. There is **no scheduled job**.

### CORS (hard requirement)
- The exchange allows **only** `https://skillhub365.co.in`. That rule is the explicit constant
  `SSO_ALLOWED_ORIGINS` in `_shared/skilltrack-sso-cors.ts`, matched as an exact string.
- It does **not** use the shared `corsHeadersFor` or the `ALLOWED_ORIGINS` secret. Lovable
  preview, `localhost` and custom origins are refused too.
- A preflight from the allowed origin gets 204 with the CORS headers. Any other origin, or a
  request with no Origin, gets 403 with no `Access-Control-Allow-Origin`, before any token or DB
  work.
- Consequence: SSO can only be exercised from the production SkillHub origin, not from
  Lovable/Vercel previews.

### User creation rule (v1, Atlas decision)
**No auto-create.** `no_account` sends the user to SkillHub `/signup` with the email prefilled.
Every other failure goes to `/login` with the email prefilled.

### SPA (SkillHub `src/pages/SkillTrackSso.tsx`, route `/sso/skilltrack`)
- Strips the fragment with `history.replaceState` before any network call. Runs once, even under
  StrictMode.
- On success it waits for `AuthProvider` to see the session, then goes to `/`;
  `RoleProtectedRoute` sends learners to `/student`.
- On any failure it stores the email in the existing handoff store and goes to `/login`
  (or `/signup` on `no_account`). That is today's behaviour, so SSO can only help.

### "400" / duplicate-log fix (SkillHub `SkillTrackHandoffCapture`)
- It logs only once auth has loaded **and** there is a signed-in user. There is no more
  anonymous insert.
- Each capture logs at most once per user (`shouldLogHandoff`, a sessionStorage marker).
- It ignores `/sso/skilltrack`, because that page owns its own flow.

### SkillTrack click handling (`src/lib/skillhub-sso-launch.ts`, nav in `site-layout.tsx`)
- Signed-out users and modified clicks (cmd, ctrl, shift, alt, middle) keep the plain link,
  unchanged.
- For a signed-in plain click it opens `about:blank` synchronously (so popup blockers allow it),
  sets `opener = null`, then fetches the link with a 4 s timeout.
- It only accepts a URL starting with `https://skillhub365.co.in/sso/skilltrack#`. Otherwise it
  uses the old handoff URL.
- `/labs` (SSR redirect) is unchanged; it has no session on the server. This is an Atlas
  decision: SSO happens on the Labs click, client-side only.

## 3. Failure modes

| Case | Result |
|---|---|
| Key not set on SkillTrack | server fn returns `{url:null}`, so the old link is used (no change) |
| Key not set on SkillHub | 503 `not_configured`, then `/login` with email prefilled |
| jti table not created | 503 `replay_store_unavailable`, then `/login` (fails closed) |
| Token expired / tampered / wrong aud | 401 `invalid_token`, then `/login` |
| Token replayed (reload, shared link) | 409 `replayed`, then `/login` |
| No SkillHub account | 404 `no_account`, then `/signup` with email prefilled |
| Admin/instructor account | 403 `privileged_account`, then `/login` |
| Slow SkillTrack server (>4 s) | old handoff link |
| Popup blocked | navigates current tab |
| Call from any origin other than `https://skillhub365.co.in` | 403 `origin_not_allowed`, no ACAO |
| jti cleanup delete fails | ignored (logged by code), exchange unaffected |
| Clock skew > 30 s | `expired` / `not_yet_valid`, then `/login` |

## 4. HELD items (need Atlas first; nothing created or applied)

1. **Secret** `SKILLTRACK_SSO_SIGNING_KEY` must be set to the **same value** in both places:
   - SkillTrack: Lovable Cloud server secret, project `1e70e9f7…`
   - SkillHub: Supabase edge-function secret, project `ubitkkcukilxzybodwcc`

   Generate it with at least 32 random bytes. The value never goes into git or chat.
2. **Migration** `docs/st-54/HELD-20261109-skilltrack-sso-jti.sql` (SkillHub PR) creates
   `public.skilltrack_sso_jti` (RLS on, no policies, service role only). It is deliberately
   **not** in `supabase/migrations/`, so Lovable can't auto-apply it.
3. **Edge deploy** of `skilltrack-sso-exchange`. `config.toml` adds `verify_jwt = false`, because the
   caller is anonymous and the token is the credential.
4. **CORS:** none needed. The function enforces its own single-origin allowlist and does not read
   `ALLOWED_ORIGINS`. (For reference, the shared helper `_shared/auth.ts#isAllowedOrigin` hard-codes
   `*.lovable.app`, `*.lovableproject.com`, `localhost` and `127.0.0.1`, and adds the
   comma-separated `ALLOWED_ORIGINS` secret. `skillhub365.co.in` is not hard-coded there.)
5. **Supabase Auth settings (SkillHub):** the magic-link OTP expiry is the default and is fine.
   No redirect URL is needed, because `verifyOtp` runs in-page.

## 5. Rollout order (after GO)
1. Apply the jti migration (SkillHub).
2. Set the SkillHub secret, then deploy `skilltrack-sso-exchange`, then merge and publish the SkillHub PR.
3. Smoke-test with a test learner account. **Vivek names the account.** Steps: an anonymous-looking POST with a junk
   token must return 401, and a real click must land signed in.
4. Set the SkillTrack secret, merge and publish the SkillTrack PR. SSO turns on at this step.

## 6. Rollback
- **Fastest:** remove `SKILLTRACK_SSO_SIGNING_KEY` from SkillTrack. The server fn returns `null` and
  Labs is the plain link again, with no deploy.
- Or remove it on SkillHub: the exchange returns 503 and users go to `/login`, as today.
- Code: revert either PR. Old link on new SkillHub works unchanged. But new SkillTrack (key set)
  against reverted SkillHub would land on a 404 page, so always unset the SkillTrack key (or revert
  SkillTrack) **before** reverting SkillHub.
- DB: `drop table public.skilltrack_sso_jti;` (in the held SQL). The cleanup delete is best effort, so it is harmless while the table is missing.

## 7. Tests
- SkillTrack `src/lib/skillhub-sso.test.ts`:
  - token claims, HMAC, 60 s TTL and random jti
  - null without a key or a verified email
  - fragment URL
  - click interception, fallback and timeout, popup handling
  - a **cross-repo vector**
- SkillHub `src/test/skilltrack-sso.test.ts`:
  - verifier accept/reject (alg, iss, aud, expiry, TTL, tamper)
  - exchange order, replay, fails closed, matching rules, privileged refusal
  - client fragment parsing, verifyOtp, the once-only log fix
  - the **same cross-repo vector**
- SkillHub `src/test/skilltrack-sso-cors.test.ts`:
  - only the single allowed origin passes; look-alike, http, subdomain, preview, localhost and
    missing origins get 403 with no ACAO
  - preflight returns 204
  - `ALLOWED_ORIGINS` is never read
  - best-effort cleanup never throws or blocks
- SkillHub Deno tests `_shared/skilltrack-sso-token.test.ts` and `_shared/skilltrack-sso-cors.test.ts`
  run the verifier and the CORS gate under Deno, the latter with `ALLOWED_ORIGINS` set to a
  different origin.

## 8. Decisions (Atlas, Eng PASS, 9 Nov 2026)
1. **No auto-create.** Unknown emails go to `/signup` with the email prefilled; other failures go
   to `/login` with the email prefilled.
2. **Learners only for v1.** Admin, super_admin, content_admin and instructor accounts are
   refused SSO.
3. **HS256 for v1.** ES256 (a key pair, so no shared secret) is a later ticket.
4. **Labs click on the client only.** The `/labs` server redirect is unchanged.
5. **Opportunistic jti cleanup** in the exchange; no scheduled job.
6. **Vivek names the smoke-test learner** account.

Still HELD on Atlas GO: the secret, the migration, the edge deploy, and the merge/publish.
