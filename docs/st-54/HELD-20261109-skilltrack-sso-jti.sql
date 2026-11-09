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

-- Housekeeping (optional, also held): rows are useless once expires_at has passed.
-- delete from public.skilltrack_sso_jti where expires_at < now() - interval '1 day';

-- Rollback:
-- drop table if exists public.skilltrack_sso_jti;
