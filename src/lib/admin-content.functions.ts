import { supabase } from "@/integrations/supabase/client";

export interface CertificationInput {
  slug: string;
  name: string;
  description?: string | null;
  org_id?: string | null;
  published?: boolean;
}

export interface MockExamInput {
  cert_slug: string;
  title: string;
  duration_min?: number;
  org_id?: string | null;
  published?: boolean;
}

export async function listCertifications(orgId?: string | null) {
  let q = supabase.from("certifications_catalog").select("*").order("created_at", { ascending: false });
  if (orgId === null) q = q.is("org_id", null);
  else if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertCertification(input: CertificationInput & { id?: string }) {
  const { data: u } = await supabase.auth.getUser();
  const payload = { ...input, created_by: input.id ? undefined : u?.user?.id };
  const { data, error } = await supabase
    .from("certifications_catalog")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCertification(id: string) {
  const { error } = await supabase.from("certifications_catalog").delete().eq("id", id);
  if (error) throw error;
}

export async function listMockExams(opts: { orgId?: string | null; certSlug?: string } = {}) {
  let q = supabase.from("mock_exams").select("*").order("created_at", { ascending: false });
  if (opts.orgId === null) q = q.is("org_id", null);
  else if (opts.orgId) q = q.eq("org_id", opts.orgId);
  if (opts.certSlug) q = q.eq("cert_slug", opts.certSlug);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertMockExam(input: MockExamInput & { id?: string }) {
  const { data: u } = await supabase.auth.getUser();
  const payload = { ...input, created_by: input.id ? undefined : u?.user?.id };
  const { data, error } = await supabase
    .from("mock_exams")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMockExam(id: string) {
  const { error } = await supabase.from("mock_exams").delete().eq("id", id);
  if (error) throw error;
}

export async function listOrganizations() {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertOrganization(input: { id?: string; name: string; slug: string }) {
  const { data: u } = await supabase.auth.getUser();
  const payload = { ...input, created_by: input.id ? undefined : u?.user?.id };
  const { data, error } = await supabase
    .from("organizations")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOrganization(id: string) {
  const { error } = await supabase.from("organizations").delete().eq("id", id);
  if (error) throw error;
}
