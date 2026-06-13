
CREATE POLICY "resources platform admins read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resources' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "resources platform admins write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resources' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "resources platform admins update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resources' AND public.is_platform_admin(auth.uid()))
  WITH CHECK (bucket_id = 'resources' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "resources platform admins delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resources' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "resources org managers read scoped"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'resources'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'exec')
      OR public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager')
    )
  );

CREATE POLICY "resources org managers write scoped"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resources'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'exec')
      OR public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager')
    )
  );

CREATE POLICY "resources org managers delete scoped"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resources'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'exec')
      OR public.is_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager')
    )
  );
