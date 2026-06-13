import { supabase } from "@/integrations/supabase/client";
import type { AssetType } from "@/lib/access-control.functions";

export interface ManualGrantInput {
  id?: string;
  user_id: string;
  asset_type?: AssetType | null;
  asset_id?: string | null;
  certification_slug?: string | null;
  plan_key?: string | null;
  starts_at?: string;
  ends_at?: string | null;
  active?: boolean;
  note?: string | null;
}

export async function listGrants(opts: { userId?: string } = {}) {
  let q = supabase.from("manual_access_grants").select("*").order("created_at", { ascending: false });
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertGrant(input: ManualGrantInput) {
  const { data: u } = await supabase.auth.getUser();
  const payload = { ...input, granted_by: input.id ? undefined : u?.user?.id };
  const { data, error } = await supabase
    .from("manual_access_grants")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokeGrant(id: string) {
  const { error } = await supabase
    .from("manual_access_grants")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteGrant(id: string) {
  const { error } = await supabase.from("manual_access_grants").delete().eq("id", id);
  if (error) throw error;
}

export async function listAccessRules(opts: { assetType?: AssetType; assetId?: string } = {}) {
  let q = supabase.from("access_rules").select("*").order("updated_at", { ascending: false });
  if (opts.assetType) q = q.eq("asset_type", opts.assetType);
  if (opts.assetId) q = q.eq("asset_id", opts.assetId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertAccessRule(input: {
  id?: string;
  asset_type: AssetType;
  asset_id: string;
  required_role?: string | null;
  required_plan?: string | null;
  active?: boolean;
}) {
  const { data: u } = await supabase.auth.getUser();
  const payload = { ...input, created_by: input.id ? undefined : u?.user?.id };
  const { data, error } = await supabase
    .from("access_rules")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAccessRule(id: string) {
  const { error } = await supabase.from("access_rules").delete().eq("id", id);
  if (error) throw error;
}
