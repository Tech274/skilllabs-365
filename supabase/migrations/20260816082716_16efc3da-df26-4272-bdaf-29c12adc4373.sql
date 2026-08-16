ALTER TABLE public.ai_request_logs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_request_logs_user_created_idx ON public.ai_request_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_request_logs_org_created_idx ON public.ai_request_logs (org_id, created_at DESC);

CREATE TABLE public.ai_usage_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('user','org','global')),
  scope_id uuid,
  per_minute_limit integer NOT NULL DEFAULT 10 CHECK (per_minute_limit >= 0),
  daily_limit integer NOT NULL DEFAULT 200 CHECK (daily_limit >= 0),
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_usage_quotas_scope_key ON public.ai_usage_quotas (scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_quotas TO authenticated;
GRANT ALL ON public.ai_usage_quotas TO service_role;
ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage AI quotas" ON public.ai_usage_quotas
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TRIGGER ai_usage_quotas_updated_at BEFORE UPDATE ON public.ai_usage_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_title text NOT NULL,
  alert_status text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app','webhook')),
  delivery_status text NOT NULL CHECK (delivery_status IN ('sent','failed','deduplicated','skipped')),
  recipients integer NOT NULL DEFAULT 0,
  latency_ms integer,
  model text,
  detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX ai_alert_deliveries_created_idx ON public.ai_alert_deliveries (created_at DESC);

GRANT SELECT ON public.ai_alert_deliveries TO authenticated;
GRANT ALL ON public.ai_alert_deliveries TO service_role;
ALTER TABLE public.ai_alert_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read AI alert deliveries" ON public.ai_alert_deliveries
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));