CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now();