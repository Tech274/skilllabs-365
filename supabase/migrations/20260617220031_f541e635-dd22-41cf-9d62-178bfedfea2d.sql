ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS guac_connection_id text,
  ADD COLUMN IF NOT EXISTS guac_username text;
CREATE INDEX IF NOT EXISTS sessions_guac_connection_id_idx ON public.sessions(guac_connection_id);