ALTER TABLE public.lab_templates
  ADD COLUMN IF NOT EXISTS provider public.cloud_provider NOT NULL DEFAULT 'azure',
  ADD COLUMN IF NOT EXISTS provider_account_id uuid REFERENCES public.cloud_provider_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.virtual_machines
  ADD COLUMN IF NOT EXISTS provider_account_id uuid REFERENCES public.cloud_provider_accounts(id) ON DELETE SET NULL;

-- Legacy single-Azure-subscription configuration is replaced by cloud_provider_accounts.
DROP TABLE IF EXISTS public.cloud_provider_config;