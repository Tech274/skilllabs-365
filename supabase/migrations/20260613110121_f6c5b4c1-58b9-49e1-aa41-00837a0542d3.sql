
-- platform admin helper
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::app_role,'super_admin'::app_role,'content_admin'::app_role)
  )
$$;

-- ============================================================
-- organizations
-- ============================================================
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- org_members
-- ============================================================
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_role text NOT NULL CHECK (org_role IN ('exec','manager','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _user_id AND org_id = _org_id)
$$;

CREATE OR REPLACE FUNCTION public.is_org_role(_user_id uuid, _org_id uuid, _role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _user_id AND org_id = _org_id AND org_role = _role)
$$;

CREATE POLICY "platform admins manage organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "members can read their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "platform admins manage org_members"
  ON public.org_members FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "org execs manage their org members"
  ON public.org_members FOR ALL TO authenticated
  USING (public.is_org_role(auth.uid(), org_id, 'exec'))
  WITH CHECK (public.is_org_role(auth.uid(), org_id, 'exec'));

CREATE POLICY "users read their own memberships"
  ON public.org_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- certifications_catalog
-- ============================================================
CREATE TABLE public.certifications_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications_catalog TO authenticated;
GRANT ALL ON public.certifications_catalog TO service_role;
ALTER TABLE public.certifications_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage certifications"
  ON public.certifications_catalog FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "org managers manage their certifications"
  ON public.certifications_catalog FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')))
  WITH CHECK (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')));

CREATE POLICY "read published global certifications"
  ON public.certifications_catalog FOR SELECT TO authenticated
  USING (published = true AND org_id IS NULL);

CREATE POLICY "org members read their published certifications"
  ON public.certifications_catalog FOR SELECT TO authenticated
  USING (published = true AND org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id));

-- ============================================================
-- mock_exams
-- ============================================================
CREATE TABLE public.mock_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_slug text NOT NULL,
  title text NOT NULL,
  duration_min integer NOT NULL DEFAULT 60,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exams TO authenticated;
GRANT ALL ON public.mock_exams TO service_role;
ALTER TABLE public.mock_exams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage mock_exams"
  ON public.mock_exams FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "org managers manage their mock_exams"
  ON public.mock_exams FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')))
  WITH CHECK (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')));

CREATE POLICY "read published global mock_exams"
  ON public.mock_exams FOR SELECT TO authenticated
  USING (published = true AND org_id IS NULL);

CREATE POLICY "org members read their published mock_exams"
  ON public.mock_exams FOR SELECT TO authenticated
  USING (published = true AND org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id));

-- ============================================================
-- question_bank
-- ============================================================
CREATE TABLE public.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_exam_id uuid NOT NULL REFERENCES public.mock_exams(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text NOT NULL,
  explanation text,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_bank TO authenticated;
GRANT ALL ON public.question_bank TO service_role;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage question_bank"
  ON public.question_bank FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "org managers manage their questions"
  ON public.question_bank FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')))
  WITH CHECK (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')));

-- ============================================================
-- resources
-- ============================================================
CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('file','link','video','doc')),
  storage_path text,
  external_url text,
  published boolean NOT NULL DEFAULT false,
  downloads_enabled boolean NOT NULL DEFAULT true,
  required_role text,
  required_plan text,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage resources"
  ON public.resources FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "org managers manage their resources"
  ON public.resources FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')))
  WITH CHECK (org_id IS NOT NULL AND (public.is_org_role(auth.uid(), org_id, 'exec') OR public.is_org_role(auth.uid(), org_id, 'manager')));

CREATE POLICY "read published global resources metadata"
  ON public.resources FOR SELECT TO authenticated
  USING (published = true AND org_id IS NULL);

CREATE POLICY "org members read their published resources metadata"
  ON public.resources FOR SELECT TO authenticated
  USING (published = true AND org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id));

-- ============================================================
-- access_rules
-- ============================================================
CREATE TABLE public.access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('resource','mock_exam','certification','lab_template')),
  asset_id uuid NOT NULL,
  required_role text,
  required_plan text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_rules_asset ON public.access_rules(asset_type, asset_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_rules TO authenticated;
GRANT ALL ON public.access_rules TO service_role;
ALTER TABLE public.access_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage access_rules"
  ON public.access_rules FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "authenticated read active access_rules"
  ON public.access_rules FOR SELECT TO authenticated
  USING (active = true);

-- ============================================================
-- manual_access_grants
-- ============================================================
CREATE TABLE public.manual_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type text,
  asset_id uuid,
  certification_slug text,
  plan_key text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_grants_user ON public.manual_access_grants(user_id);
CREATE INDEX idx_grants_lookup ON public.manual_access_grants(user_id, asset_type, asset_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_access_grants TO authenticated;
GRANT ALL ON public.manual_access_grants TO service_role;
ALTER TABLE public.manual_access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage grants"
  ON public.manual_access_grants FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "users read their own grants"
  ON public.manual_access_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- subscriptions (locked placeholder)
-- ============================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_key text NOT NULL,
  status text NOT NULL DEFAULT 'inactive',
  provider text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage subscriptions"
  ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "users read their own subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- has_asset_access (access engine)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_asset_access(
  _user_id uuid,
  _asset_type text,
  _asset_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _rule RECORD;
  _has_role boolean;
  _has_grant boolean;
  _has_sub boolean;
BEGIN
  IF public.is_platform_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT required_role, required_plan INTO _rule
  FROM public.access_rules
  WHERE asset_type = _asset_type AND asset_id = _asset_id AND active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  IF _rule.required_role IS NOT NULL AND _rule.required_role <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role::text = _rule.required_role
    ) INTO _has_role;
    IF _has_role THEN RETURN true; END IF;
  END IF;

  IF _rule.required_plan IS NOT NULL AND _rule.required_plan <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.manual_access_grants
      WHERE user_id = _user_id
        AND active = true
        AND (ends_at IS NULL OR ends_at > now())
        AND starts_at <= now()
        AND (
          (asset_type = _asset_type AND asset_id = _asset_id)
          OR (plan_key = _rule.required_plan)
        )
    ) INTO _has_grant;
    IF _has_grant THEN RETURN true; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = _user_id
        AND plan_key = _rule.required_plan
        AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > now())
    ) INTO _has_sub;
    IF _has_sub THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cert_updated BEFORE UPDATE ON public.certifications_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mock_updated BEFORE UPDATE ON public.mock_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_qb_updated BEFORE UPDATE ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_res_updated BEFORE UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON public.access_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_grants_updated BEFORE UPDATE ON public.manual_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
