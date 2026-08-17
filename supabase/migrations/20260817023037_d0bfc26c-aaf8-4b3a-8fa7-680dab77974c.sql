CREATE TABLE public.cloud_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.cloud_provider NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  default_region text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_test_status text,
  last_test_message text,
  last_tested_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cloud_provider_accounts_slug_idx ON public.cloud_provider_accounts (provider, slug);
CREATE UNIQUE INDEX cloud_provider_accounts_default_idx ON public.cloud_provider_accounts (provider) WHERE is_default;

GRANT SELECT (id, provider, slug, display_name, description, status, is_default, default_region, config, last_test_status, last_test_message, last_tested_at, created_by, created_at, updated_at) ON public.cloud_provider_accounts TO authenticated;
GRANT ALL ON public.cloud_provider_accounts TO service_role;

ALTER TABLE public.cloud_provider_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view provider accounts"
ON public.cloud_provider_accounts FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

CREATE TRIGGER cloud_provider_accounts_updated_at
BEFORE UPDATE ON public.cloud_provider_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.access_templates
  ADD COLUMN provider_account_id uuid REFERENCES public.cloud_provider_accounts(id) ON DELETE SET NULL;

DELETE FROM public.cloud_provider_config WHERE provider = 'azure';