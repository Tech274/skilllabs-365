/**
 * Access request domain helpers.
 *
 * Kept free of React and Supabase so the review-permission rules and list
 * filtering can be unit tested exactly as the UI and the edge function apply
 * them.
 */

export type AccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AccessResourceType = "vm_lab" | "cloud_access";

export interface AccessRequestRow {
  id: string;
  requester_id: string;
  resource_type: AccessResourceType;
  resource_id: string;
  status: AccessRequestStatus;
  reason: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  resource_name?: string | null;
  resource_provider?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  reviewer_email?: string | null;
  can_review?: boolean;
}

export const REQUEST_STATUSES: AccessRequestStatus[] = ["pending", "approved", "rejected", "cancelled"];

export const STATUS_VARIANT: Record<AccessRequestStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  rejected: "destructive",
  cancelled: "secondary",
};

export const RESOURCE_LABEL: Record<AccessResourceType, string> = {
  vm_lab: "VM Lab",
  cloud_access: "Cloud Access",
};

/**
 * Who may approve or reject a request.
 * Admins review everything. Instructors review only VM lab requests for lab
 * templates assigned to them — never cloud access.
 */
export function canReviewRequest(
  viewer: { isAdmin: boolean; instructorLabIds: string[] },
  request: Pick<AccessRequestRow, "resource_type" | "resource_id">,
): boolean {
  if (viewer.isAdmin) return true;
  if (request.resource_type !== "vm_lab") return false;
  return viewer.instructorLabIds.includes(request.resource_id);
}

export function filterAccessRequests(
  rows: AccessRequestRow[],
  opts: { status?: AccessRequestStatus | "all"; resourceType?: AccessResourceType | "all"; search?: string },
): AccessRequestRow[] {
  const q = (opts.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.status && opts.status !== "all" && r.status !== opts.status) return false;
    if (opts.resourceType && opts.resourceType !== "all" && r.resource_type !== opts.resourceType) return false;
    if (!q) return true;
    return [r.requester_email, r.requester_name, r.resource_name, r.reason, r.resource_provider]
      .some((v) => (v ?? "").toLowerCase().includes(q));
  });
}
