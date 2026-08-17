ALTER TABLE public.provisioning_idempotency
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS vm_id uuid,
  ADD COLUMN IF NOT EXISTS last_retried_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_retried_by uuid;

CREATE TABLE IF NOT EXISTS public.export_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_email text,
  actor_role text,
  export_kind text NOT NULL,
  format text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.export_audit_logs TO authenticated;
GRANT ALL ON public.export_audit_logs TO service_role;

ALTER TABLE public.export_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read export audit logs"
ON public.export_audit_logs
FOR SELECT
TO authenticated
USING (public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS export_audit_logs_created_idx ON public.export_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_idempotency_status_idx ON public.provisioning_idempotency (status, created_at DESC);