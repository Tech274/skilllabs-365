
-- =========================================================
-- Enums
-- =========================================================
DO $$ BEGIN
  CREATE TYPE public.cloud_provider AS ENUM ('azure','aws','gcp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.access_template_status AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.access_session_status AS ENUM ('created','active','expired','refreshed','revoked','failed','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.template_assignee_type AS ENUM ('user','org','group','self_enroll');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- access_templates
-- =========================================================
CREATE TABLE IF NOT EXISTS public.access_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  provider public.cloud_provider NOT NULL,
  validity_days integer NOT NULL DEFAULT 30 CHECK (validity_days > 0),
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  session_duration_minutes integer NOT NULL DEFAULT 60 CHECK (session_duration_minutes > 0),
  region text,
  self_enroll boolean NOT NULL DEFAULT false,
  refresh_allowed boolean NOT NULL DEFAULT true,
  status public.access_template_status NOT NULL DEFAULT 'draft',
  allowed_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_templates TO authenticated;
GRANT ALL ON public.access_templates TO service_role;
ALTER TABLE public.access_templates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS access_templates_provider_idx ON public.access_templates(provider);
CREATE INDEX IF NOT EXISTS access_templates_status_idx ON public.access_templates(status);
CREATE INDEX IF NOT EXISTS access_templates_org_idx ON public.access_templates(org_id);

CREATE TRIGGER access_templates_updated_at
  BEFORE UPDATE ON public.access_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- template_batches
-- =========================================================
CREATE TABLE IF NOT EXISTS public.template_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.access_templates(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  name text NOT NULL,
  start_date date,
  end_date date,
  lab_count integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  credit_allocation numeric(12,2) NOT NULL DEFAULT 0,
  session_duration_override integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_batches TO authenticated;
GRANT ALL ON public.template_batches TO service_role;
ALTER TABLE public.template_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS template_batches_template_idx ON public.template_batches(template_id);
CREATE INDEX IF NOT EXISTS template_batches_published_idx ON public.template_batches(published);

CREATE TRIGGER template_batches_updated_at
  BEFORE UPDATE ON public.template_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- template_workspace_batches
-- =========================================================
CREATE TABLE IF NOT EXISTS public.template_workspace_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.access_templates(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  workspace_group_id uuid,
  name text NOT NULL,
  start_date date,
  end_date date,
  lab_count integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  shared_credit_pool numeric(12,2) NOT NULL DEFAULT 0,
  session_duration_override integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_workspace_batches TO authenticated;
GRANT ALL ON public.template_workspace_batches TO service_role;
ALTER TABLE public.template_workspace_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS template_ws_batches_template_idx ON public.template_workspace_batches(template_id);

CREATE TRIGGER template_ws_batches_updated_at
  BEFORE UPDATE ON public.template_workspace_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- template_assignments
-- =========================================================
CREATE TABLE IF NOT EXISTS public.template_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.access_templates(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.template_batches(id) ON DELETE CASCADE,
  workspace_batch_id uuid REFERENCES public.template_workspace_batches(id) ON DELETE CASCADE,
  assignee_type public.template_assignee_type NOT NULL,
  assignee_id uuid,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (
    (assignee_type = 'self_enroll' AND assignee_id IS NULL)
    OR (assignee_type <> 'self_enroll' AND assignee_id IS NOT NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_assignments TO authenticated;
GRANT ALL ON public.template_assignments TO service_role;
ALTER TABLE public.template_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS tmpl_assign_template_idx ON public.template_assignments(template_id);
CREATE INDEX IF NOT EXISTS tmpl_assign_assignee_idx ON public.template_assignments(assignee_type, assignee_id);
CREATE INDEX IF NOT EXISTS tmpl_assign_batch_idx ON public.template_assignments(batch_id);
CREATE INDEX IF NOT EXISTS tmpl_assign_wsbatch_idx ON public.template_assignments(workspace_batch_id);

-- =========================================================
-- access_sessions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.access_templates(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.template_batches(id) ON DELETE SET NULL,
  workspace_batch_id uuid REFERENCES public.template_workspace_batches(id) ON DELETE SET NULL,
  parent_session_id uuid REFERENCES public.access_sessions(id) ON DELETE SET NULL,
  provider public.cloud_provider NOT NULL,
  region text,
  status public.access_session_status NOT NULL DEFAULT 'created',
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  refresh_count integer NOT NULL DEFAULT 0,
  credit_consumed numeric(12,4) NOT NULL DEFAULT 0,
  federated_url text,
  provider_session_ref text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_sessions TO authenticated;
GRANT ALL ON public.access_sessions TO service_role;
ALTER TABLE public.access_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS access_sessions_user_idx ON public.access_sessions(user_id);
CREATE INDEX IF NOT EXISTS access_sessions_template_idx ON public.access_sessions(template_id);
CREATE INDEX IF NOT EXISTS access_sessions_status_idx ON public.access_sessions(status);
CREATE INDEX IF NOT EXISTS access_sessions_expires_idx ON public.access_sessions(expires_at);

CREATE TRIGGER access_sessions_updated_at
  BEFORE UPDATE ON public.access_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- access_session_events
-- =========================================================
CREATE TABLE IF NOT EXISTS public.access_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.access_sessions(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.access_session_events TO authenticated;
GRANT ALL ON public.access_session_events TO service_role;
ALTER TABLE public.access_session_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS access_session_events_session_idx ON public.access_session_events(session_id);
CREATE INDEX IF NOT EXISTS access_session_events_type_idx ON public.access_session_events(event_type);

-- =========================================================
-- Entitlement RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.user_can_access_template(_user_id uuid, _template_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tpl public.access_templates%ROWTYPE;
BEGIN
  IF public.is_platform_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT * INTO _tpl FROM public.access_templates WHERE id = _template_id;
  IF NOT FOUND OR _tpl.status <> 'published' THEN
    RETURN false;
  END IF;

  -- self-enroll
  IF _tpl.self_enroll THEN
    RETURN true;
  END IF;

  -- direct user assignment
  IF EXISTS (
    SELECT 1 FROM public.template_assignments ta
    WHERE ta.template_id = _template_id
      AND ta.revoked_at IS NULL
      AND (
        (ta.assignee_type = 'user' AND ta.assignee_id = _user_id)
        OR (ta.assignee_type = 'org'  AND public.is_org_member(_user_id, ta.assignee_id))
        OR (ta.assignee_type = 'self_enroll')
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- =========================================================
-- RLS policies
-- =========================================================

-- access_templates
CREATE POLICY "templates_select_entitled"
  ON public.access_templates FOR SELECT TO authenticated
  USING (public.user_can_access_template(auth.uid(), id));

CREATE POLICY "templates_admin_write"
  ON public.access_templates FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- template_batches: admin full, entitled users can read batches whose template they can access
CREATE POLICY "batches_select_entitled"
  ON public.template_batches FOR SELECT TO authenticated
  USING (public.user_can_access_template(auth.uid(), template_id));

CREATE POLICY "batches_admin_write"
  ON public.template_batches FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- template_workspace_batches
CREATE POLICY "ws_batches_select_entitled"
  ON public.template_workspace_batches FOR SELECT TO authenticated
  USING (public.user_can_access_template(auth.uid(), template_id));

CREATE POLICY "ws_batches_admin_write"
  ON public.template_workspace_batches FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- template_assignments: admin-only
CREATE POLICY "assignments_admin_all"
  ON public.template_assignments FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- access_sessions: user sees own; admin sees all; user can insert own
CREATE POLICY "sessions_owner_or_admin_select"
  ON public.access_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY "sessions_owner_insert"
  ON public.access_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.user_can_access_template(auth.uid(), template_id));

CREATE POLICY "sessions_owner_or_admin_update"
  ON public.access_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY "sessions_admin_delete"
  ON public.access_sessions FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- access_session_events: user can read events for own sessions; admin all; inserts via service role normally
CREATE POLICY "session_events_owner_or_admin_select"
  ON public.access_session_events FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.access_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  );

CREATE POLICY "session_events_owner_or_admin_insert"
  ON public.access_session_events FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.access_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  );
