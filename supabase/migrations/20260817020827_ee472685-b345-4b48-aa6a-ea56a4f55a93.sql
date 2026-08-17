ALTER TABLE public.lab_templates DROP CONSTRAINT IF EXISTS lab_templates_status_check;
UPDATE public.lab_templates SET status = 'published' WHERE status = 'active';
ALTER TABLE public.lab_templates ADD CONSTRAINT lab_templates_status_check CHECK (status IN ('draft','published','archived'));
ALTER TABLE public.lab_templates ALTER COLUMN status SET DEFAULT 'draft';

DROP POLICY IF EXISTS "Users can view published lab templates" ON public.lab_templates;
CREATE POLICY "Users can view published lab templates" ON public.lab_templates
  FOR SELECT TO authenticated
  USING (status = 'published');