# ST-54 (SkillHub side) — SkillTrack single sign-on

- Plan: [`SSO-PLAN.md`](./SSO-PLAN.md) (same file in sktrck365 `docs/st-54/`).
- **HELD, not applied:** `HELD-20261109-skilltrack-sso-jti.sql`. It is kept out of `supabase/migrations/`
  on purpose.
- **HELD, not set:** secret `SKILLTRACK_SSO_SIGNING_KEY` (edge-function secret).
- **HELD, not deployed:** edge function `skilltrack-sso-exchange`.
- Without the secret and the table, the exchange returns 503 and `/sso/skilltrack` falls back to
  `/login`, which is today's flow.
