
ALTER TABLE public.sessions 
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS connection_quality text NOT NULL DEFAULT 'good',
  ADD COLUMN IF NOT EXISTS disconnects integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_template_id uuid REFERENCES public.lab_templates(id);
