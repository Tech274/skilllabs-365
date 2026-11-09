-- HELD (ST-54). NOT APPLIED. Do not move into supabase/migrations/ until Atlas GO
-- (Lovable may auto-apply files there). Apply once, by hand, after review.
--
-- Single-use store for SkillTrack SSO token ids (jti). The exchange edge function
-- inserts one row per token; a duplicate (23505) is a replay and is refused.
-- Only the service role touches it: RLS on, no policies, no grants to anon/authenticated.

create table if not exists public.skilltrack_sso_jti (
  jti text primary key,
  skilltrack_user_id text not null,
  expires_at timestamptz not null,
  used_at timestamptz not null default now()
);

alter table public.skilltrack_sso_jti enable row level security;
revoke all on public.skilltrack_sso_jti from anon, authenticated;

create index if not exists skilltrack_sso_jti_expires_at_idx
  on public.skilltrack_sso_jti (expires_at);

-- Housekeeping: no scheduled job. The exchange function deletes rows with
-- expires_at < now() - 1 day opportunistically on each call (best effort; a
-- failed cleanup never fails or delays the exchange). The expires_at index
-- above keeps that delete cheap.

-- Rollback:
-- drop table if exists public.skilltrack_sso_jti;
