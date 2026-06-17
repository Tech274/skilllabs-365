-- Per-user Azure Entra object id (oid) used for RBAC role assignments
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS azure_object_id text;

-- Non-secret cloud provider configuration (defaults / scopes)
CREATE TABLE IF NOT EXISTS public.cloud_provider_config (
  provider text PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cloud_provider_config TO authenticated;
GRANT ALL    ON public.cloud_provider_config TO service_role;
ALTER TABLE public.cloud_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read cloud provider config"
  ON public.cloud_provider_config FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "admins manage cloud provider config"
  ON public.cloud_provider_config FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TRIGGER cloud_provider_config_updated_at
  BEFORE UPDATE ON public.cloud_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed rows so admin UI has something to edit (no secrets in here).
INSERT INTO public.cloud_provider_config(provider, config) VALUES
  ('aws',   '{"default_region":"us-east-1","default_role_arn":null,"session_policy":null}'::jsonb),
  ('azure', '{"subscription_id":null,"resource_group":null,"role_definition_id":"acdd72a7-3385-48ef-bd42-f606fba81ae7","tenant_id":null,"use_pim":false}'::jsonb)
ON CONFLICT (provider) DO NOTHING;