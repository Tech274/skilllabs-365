import { supabase } from "@/integrations/supabase/client";

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface AccessGrantRow {
  id: string;
  user_id: string;
  approval_status: ApprovalStatus;
  active: boolean;
  source: string;
  certification_slug: string | null;
  plan_key: string | null;
  note: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  email?: string | null;
  display_name?: string | null;
}

/** All learner lab-access grants with the learner's name and email attached. */
export async function listAccessGrants(): Promise<AccessGrantRow[]> {
  const { data, error } = await supabase
    .from("manual_access_grants")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as AccessGrantRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length === 0) return rows;
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email, display_name")
    .in("user_id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  return rows.map((r) => ({
    ...r,
    email: byId.get(r.user_id)?.email ?? null,
    display_name: byId.get(r.user_id)?.display_name ?? null,
  }));
}

export async function reviewGrant(id: string, decision: "approved" | "denied", note?: string) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("manual_access_grants")
    .update({
      approval_status: decision,
      active: decision === "approved",
      reviewed_by: u?.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Approval state of a learner, derived from their grants. */
export function grantStateFor(
  grants: Pick<AccessGrantRow, "approval_status" | "active">[],
): ApprovalStatus | "none" {
  if (grants.some((g) => g.approval_status === "approved" && g.active)) return "approved";
  if (grants.some((g) => g.approval_status === "pending")) return "pending";
  if (grants.some((g) => g.approval_status === "denied")) return "denied";
  return "none";
}
