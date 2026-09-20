ALTER TABLE public.lab_templates
  ADD COLUMN IF NOT EXISTS start_date timestamptz,
  ADD COLUMN IF NOT EXISTS end_date timestamptz;

CREATE OR REPLACE FUNCTION public.validate_lab_template_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_persistent THEN
    IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL AND NEW.end_date <= NEW.start_date THEN
      RAISE EXCEPTION 'Lab template end date must be after start date';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_lab_template_window_trg ON public.lab_templates;
CREATE TRIGGER validate_lab_template_window_trg
BEFORE INSERT OR UPDATE ON public.lab_templates
FOR EACH ROW EXECUTE FUNCTION public.validate_lab_template_window();
