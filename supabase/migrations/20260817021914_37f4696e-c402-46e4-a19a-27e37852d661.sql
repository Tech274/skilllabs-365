-- Provisioning audit timeline
CREATE TABLE public.provisioning_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  user_id UUID,
  vm_id UUID,
  session_id UUID,
  lab_template_id UUID,
  source TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT,
  detail JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provisioning_events_correlation ON public.provisioning_events (correlation_id, created_at);
CREATE INDEX idx_provisioning_events_vm ON public.provisioning_events (vm_id, created_at DESC);
CREATE INDEX idx_provisioning_events_user ON public.provisioning_events (user_id, created_at DESC);

GRANT SELECT ON public.provisioning_events TO authenticated;
GRANT ALL ON public.provisioning_events TO service_role;
ALTER TABLE public.provisioning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own provisioning events"
  ON public.provisioning_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Platform admins can view all provisioning events"
  ON public.provisioning_events FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

ALTER TABLE public.provisioning_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.provisioning_events;

-- Idempotency keys for provisioning / cancellation / session creation
CREATE TABLE public.provisioning_idempotency (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  correlation_id TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_id, action, idempotency_key)
);

CREATE INDEX idx_provisioning_idem_expiry ON public.provisioning_idempotency (expires_at);

GRANT SELECT ON public.provisioning_idempotency TO authenticated;
GRANT ALL ON public.provisioning_idempotency TO service_role;
ALTER TABLE public.provisioning_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own idempotency records"
  ON public.provisioning_idempotency FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Platform admins can view all idempotency records"
  ON public.provisioning_idempotency FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));