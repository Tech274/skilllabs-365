-- Optional soft-log for SkillTrack → SkillHub handoffs (v1). Apply when Ops is ready.
create table if not exists public.skilltrack_handoff_events (
  id uuid primary key default gen_random_uuid(),
  handoff text,
  email text,
  phone text,
  sku text,
  cert text,
  lead text,
  invoice text,
  user_id uuid,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.skilltrack_handoff_events enable row level security;

drop policy if exists "insert_handoff_events_authenticated" on public.skilltrack_handoff_events;
create policy "insert_handoff_events_authenticated"
  on public.skilltrack_handoff_events for insert
  to authenticated
  with check (true);
