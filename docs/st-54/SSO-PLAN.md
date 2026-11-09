# ST-54 — Single sign-on from SkillTrack into SkillHub Labs

Status: **PR only, HELD.** Nothing here is deployed, published or applied.
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
4. **No privileged SSO:** users with `admin`, `super_admin`, `content_admin` or `instructor` get
   403 `privileged_account` and must sign in normally. On a role-lookup error it fails closed.
5. **Session:** `auth.admin.generateLink({type:"magiclink"})` gives a single-use `hashed_token`
   (no email is sent). The browser calls `supabase.auth.verifyOtp({token_hash, type:"magiclink"})`,
   so supabase-js stores the session exactly as a normal sign-in would.

### User creation rule (v1)
**No silent account creation.** `no_account` sends the user to SkillHub `/signup` with the email
prefilled. Auto-provisioning learners is an open question (section 8).

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
- `/labs` (SSR redirect) is unchanged; it has no session on the server.

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
4. **CORS:** `_shared/auth.ts` allows `https://skillhub365.co.in` only if it is in the
   `ALLOWED_ORIGINS` secret. It presumably already is (existing functions work from prod), but this
   needs confirming; no change is made here.
5. **Supabase Auth settings (SkillHub):** the magic-link OTP expiry is the default and is fine.
   No redirect URL is needed, because `verifyOtp` runs in-page.

## 5. Rollout order (after GO)
1. Apply the jti migration (SkillHub).
2. Set the SkillHub secret, then deploy `skilltrack-sso-exchange`, then merge and publish the SkillHub PR.
3. Smoke-test with a test learner account (Vivek picks it): an anonymous-looking POST with a junk
   token must return 401, and a real click must land signed in.
4. Set the SkillTrack secret, merge and publish the SkillTrack PR. SSO turns on at this step.

## 6. Rollback
- **Fastest:** remove `SKILLTRACK_SSO_SIGNING_KEY` from SkillTrack. The server fn returns `null` and
  Labs is the plain link again, with no deploy.
- Or remove it on SkillHub: the exchange returns 503 and users go to `/login`, as today.
- Code: revert either PR. Old link on new SkillHub works unchanged. But new SkillTrack (key set)
  against reverted SkillHub would land on a 404 page, so always unset the SkillTrack key (or revert
  SkillTrack) **before** reverting SkillHub.
- DB: `drop table public.skilltrack_sso_jti;` (in the held SQL).

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
- SkillHub Deno test `_shared/skilltrack-sso-token.test.ts` runs the verifier under Deno WebCrypto.

## 8. Open questions for Atlas / Vivek
1. Auto-create SkillHub learner accounts for verified SkillTrack users, or keep `/signup` prefill (v1)?
2. Should instructors be allowed SSO? v1 refuses them, along with all admin roles.
3. HS256 shared key (v1) or ES256 key pair?
4. Should `/labs` (SSR redirect) also attempt SSO? That needs a client hop.
5. Is a scheduled cleanup of expired `skilltrack_sso_jti` rows wanted? (The held SQL has it commented out.)
