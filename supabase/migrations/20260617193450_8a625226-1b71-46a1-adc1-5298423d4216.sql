
-- lab_templates
DROP POLICY IF EXISTS "Authenticated users can view lab templates" ON public.lab_templates;
CREATE POLICY "Admins can view all lab templates" ON public.lab_templates
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()) OR has_role(auth.uid(),'instructor'::app_role));
CREATE POLICY "Users can view published lab templates" ON public.lab_templates
  FOR SELECT TO authenticated
  USING (status = 'published');

-- platform_settings
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.platform_settings;
CREATE POLICY "Admins can view settings" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

-- profiles
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

-- sessions
DROP POLICY IF EXISTS "Authenticated users can view sessions" ON public.sessions;
CREATE POLICY "Users view own sessions" ON public.sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins and instructors view all sessions" ON public.sessions
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()) OR has_role(auth.uid(),'instructor'::app_role));

-- virtual_machines
DROP POLICY IF EXISTS "Authenticated users can view VMs" ON public.virtual_machines;
CREATE POLICY "Users view own VMs" ON public.virtual_machines
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins view all VMs" ON public.virtual_machines
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));
