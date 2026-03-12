
-- Table to assign instructors to lab templates
CREATE TABLE public.lab_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lab_template_id UUID NOT NULL REFERENCES public.lab_templates(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID,
  UNIQUE(lab_template_id, instructor_id)
);

ALTER TABLE public.lab_assignments ENABLE ROW LEVEL SECURITY;

-- Admins can manage all assignments
CREATE POLICY "Admins can manage lab assignments"
  ON public.lab_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Instructors can view their own assignments
CREATE POLICY "Instructors can view own assignments"
  ON public.lab_assignments FOR SELECT TO authenticated
  USING (auth.uid() = instructor_id);
