
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'content_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_exec';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_manager';
