ALTER TABLE public.lab_templates
  ADD COLUMN IF NOT EXISTS is_persistent boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.lab_templates.is_persistent IS 'When true, VM has no soft-expiry (expires_at NULL). When false, expires_at = now + duration minutes.';
COMMENT ON COLUMN public.lab_templates.duration IS 'Total lab minutes for non-persistent allocations (soft-expiry clock).';
