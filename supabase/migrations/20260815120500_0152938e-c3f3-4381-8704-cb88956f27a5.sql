DROP POLICY IF EXISTS "authenticated read active access_rules" ON public.access_rules;
CREATE POLICY "users read access_rules for entitled assets"
ON public.access_rules FOR SELECT TO authenticated
USING (active = true AND public.has_asset_access(auth.uid(), asset_type::text, asset_id));

DROP POLICY IF EXISTS "Instructors can view daily reports" ON public.daily_reports;