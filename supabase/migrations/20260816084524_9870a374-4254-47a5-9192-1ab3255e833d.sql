CREATE TABLE IF NOT EXISTS public.cloud_provider_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  check_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy','degraded','down','unconfigured')),
  latency_ms integer,
  detail text,
  region text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_health_checked_at ON public.cloud_provider_health_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_health_provider ON public.cloud_provider_health_checks (provider, checked_at DESC);

GRANT SELECT ON public.cloud_provider_health_checks TO authenticated;
GRANT ALL ON public.cloud_provider_health_checks TO service_role;

ALTER TABLE public.cloud_provider_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read provider health"
ON public.cloud_provider_health_checks
FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

ALTER TABLE public.cloud_provider_health_checks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cloud_provider_health_checks;