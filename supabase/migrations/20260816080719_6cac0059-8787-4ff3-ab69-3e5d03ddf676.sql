CREATE TABLE public.ai_request_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name text NOT NULL,
  request_id text,
  model text,
  latency_ms integer,
  status text NOT NULL,
  http_status integer,
  error_type text,
  error_message text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_request_logs_created_at_idx ON public.ai_request_logs (created_at DESC);
CREATE INDEX ai_request_logs_status_idx ON public.ai_request_logs (status);

GRANT SELECT ON public.ai_request_logs TO authenticated;
GRANT ALL ON public.ai_request_logs TO service_role;

ALTER TABLE public.ai_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view AI request logs"
ON public.ai_request_logs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);