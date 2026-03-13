
-- Create activity_logs table
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view activity logs" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert activity logs" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;

-- Create pending_invitations table
CREATE TABLE public.pending_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role app_role NOT NULL DEFAULT 'student'::app_role,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted boolean NOT NULL DEFAULT false
);

ALTER TABLE public.pending_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage invitations" ON public.pending_invitations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Update handle_new_user to check pending_invitations
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invited_role app_role;
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);

  -- Check for pending invitation
  SELECT role INTO _invited_role
  FROM public.pending_invitations
  WHERE email = NEW.email AND accepted = false
  LIMIT 1;

  IF _invited_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _invited_role);
    UPDATE public.pending_invitations SET accepted = true WHERE email = NEW.email;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  END IF;

  RETURN NEW;
END;
$$;
