-- Admin Cloud Quotas (PR #4): sync state + quota increase request store.
-- Azure sync uses live Compute/Network usages via edge function cloud-quotas.
-- AWS Service Quotas API is NOT wired in v1 — sync state records not_connected.

-- ============================================================
-- cloud_quota_sync_state — last OK/fail per provider
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cloud_quota_sync_state (
  provider text PRIMARY KEY CHECK (provider IN ('azure', 'aws')),
  last_status text NOT NULL DEFAULT 'never'
    CHECK (last_status IN ('ok', 'fail', 'not_connected', 'never')),
  last_reason text,
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  last_synced_at timestamptz,
  home_region text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cloud_quota_sync_state (provider, last_status, last_reason, home_region)
VALUES
  ('azure', 'never', 'Not synced yet', 'centralindia'),
  ('aws', 'not_connected', 'AWS Service Quotas API not wired in Hub v1 — Sync now refreshes stub state only.', 'ap-south-1')
ON CONFLICT (provider) DO NOTHING;

GRANT SELECT ON public.cloud_quota_sync_state TO authenticated;
GRANT ALL ON public.cloud_quota_sync_state TO service_role;
ALTER TABLE public.cloud_quota_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform admins read quota sync state" ON public.cloud_quota_sync_state;
CREATE POLICY "platform admins read quota sync state"
  ON public.cloud_quota_sync_state FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- quota_increase_requests — capacity-center admin form (no auto ticket API)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quota_increase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('azure', 'aws')),
  region text NOT NULL,
  resource_name text NOT NULL,
  current_limit integer,
  requested_limit integer NOT NULL CHECK (requested_limit > 0),
  justification text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'done')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_increase_requests_provider
  ON public.quota_increase_requests(provider, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quota_increase_requests TO authenticated;
GRANT ALL ON public.quota_increase_requests TO service_role;
ALTER TABLE public.quota_increase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform admins manage quota increase requests" ON public.quota_increase_requests;
CREATE POLICY "platform admins manage quota increase requests"
  ON public.quota_increase_requests FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_quota_increase_requests_updated ON public.quota_increase_requests;
CREATE TRIGGER trg_quota_increase_requests_updated
  BEFORE UPDATE ON public.quota_increase_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
