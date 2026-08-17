CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  actor_type text NOT NULL DEFAULT 'user',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  entity_label text,
  outcome text NOT NULL DEFAULT 'success',
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view admin audit logs"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_entity_idx ON public.admin_audit_logs (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.capacity_cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  region text,
  metric text NOT NULL,
  value numeric NOT NULL,
  threshold numeric NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  notified integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.capacity_cost_alerts TO authenticated;
GRANT ALL ON public.capacity_cost_alerts TO service_role;
ALTER TABLE public.capacity_cost_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view capacity alerts"
  ON public.capacity_cost_alerts FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS capacity_cost_alerts_created_idx ON public.capacity_cost_alerts (created_at DESC);

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS reconnects integer NOT NULL DEFAULT 0;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS disconnect_reason text;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.session_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.provisioning_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.virtual_machines; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;