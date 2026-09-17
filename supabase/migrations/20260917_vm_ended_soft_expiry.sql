-- Soft-expiry hardening (Atlas GO): track who/why a VM ended, and pre-expiry warn.
-- Lab window expiry must deallocate (not hard-delete). Soft-hold purge = v2 (parked).

ALTER TABLE public.virtual_machines
  ADD COLUMN IF NOT EXISTS ended_by text,
  ADD COLUMN IF NOT EXISTS ended_reason text,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_warned_at timestamptz;

COMMENT ON COLUMN public.virtual_machines.ended_by IS
  'Actor that ended the VM: cleanup-idle-labs | labs-watchdog | auth user uuid';
COMMENT ON COLUMN public.virtual_machines.ended_reason IS
  'Why ended: lab_window_expired | idle_timeout | orphan_no_session | admin_stop | admin_delete | cancel_provisioning | stuck_provisioning | …';
COMMENT ON COLUMN public.virtual_machines.ended_at IS
  'When status moved to a terminal/hold state (deallocated/terminated/failed) via policy path';
COMMENT ON COLUMN public.virtual_machines.expiry_warned_at IS
  'When T-15m pre-expiry warning was sent to learner+admins (null = not yet warned)';

CREATE INDEX IF NOT EXISTS idx_virtual_machines_expiry_warn
  ON public.virtual_machines (expires_at)
  WHERE expiry_warned_at IS NULL
    AND status IN ('running', 'provisioning', 'starting')
    AND expires_at IS NOT NULL;
