
-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'instructor', 'student');

-- Create timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'student',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- RLS for user_roles
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lab templates table
CREATE TABLE public.lab_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  protocol TEXT NOT NULL CHECK (protocol IN ('RDP', 'SSH')),
  vm_size TEXT NOT NULL DEFAULT 'Standard_B2s',
  os_image TEXT NOT NULL DEFAULT 'Windows Server 2022',
  duration INTEGER NOT NULL DEFAULT 120,
  idle_timeout INTEGER NOT NULL DEFAULT 20,
  clipboard_enabled BOOLEAN NOT NULL DEFAULT true,
  file_transfer_enabled BOOLEAN NOT NULL DEFAULT false,
  region TEXT NOT NULL DEFAULT 'All Regions',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lab_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view lab templates" ON public.lab_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage lab templates" ON public.lab_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_lab_templates_updated_at BEFORE UPDATE ON public.lab_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Virtual machines table
CREATE TABLE public.virtual_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lab_template_id UUID REFERENCES public.lab_templates(id) ON DELETE SET NULL,
  region TEXT NOT NULL DEFAULT 'East US',
  azure_vm_id TEXT,
  private_ip TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'starting', 'running', 'idle', 'expired', 'stopped')),
  vm_size TEXT NOT NULL DEFAULT 'Standard_B2s',
  idle_minutes INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.virtual_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view VMs" ON public.virtual_machines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage VMs" ON public.virtual_machines FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_vms_updated_at BEFORE UPDATE ON public.virtual_machines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sessions table
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  vm_id UUID REFERENCES public.virtual_machines(id) ON DELETE SET NULL,
  region TEXT NOT NULL DEFAULT 'East US',
  idle_minutes INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view sessions" ON public.sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage sessions" ON public.sessions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Platform settings table
CREATE TABLE public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view settings" ON public.platform_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage settings" ON public.platform_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Insert default platform settings
INSERT INTO public.platform_settings (key, value) VALUES
  ('idle_timeout', '{"default": 20, "max": 60}'),
  ('vm_sizes', '{"allowed": ["Standard_B2s", "Standard_B2ms", "Standard_B4ms", "Standard_D2s_v3"], "default": "Standard_B2s"}'),
  ('notifications', '{"waf_alerts": true, "idle_warnings": true, "health_events": true, "email_digest": false}'),
  ('session_defaults', '{"max_duration": 240, "default_duration": 120}');
