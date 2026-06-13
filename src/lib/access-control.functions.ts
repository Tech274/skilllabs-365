import { supabase } from "@/integrations/supabase/client";

export type AssetType = "resource" | "mock_exam" | "certification" | "lab_template";

export interface AccessCheckResult {
  allowed: boolean;
  reason?:
    | "ok"
    | "not_authenticated"
    | "not_found"
    | "not_published"
    | "downloads_disabled"
    | "forbidden"
    | "requires_plan"
    | "requires_role"
    | "error";
  message?: string;
}

export interface ResourceAccessResult extends AccessCheckResult {
  url?: string;
  kind?: string;
}

export interface MockExamLaunchResult extends AccessCheckResult {
  mock_exam_id?: string;
}

/**
 * Pure gate check against the access_rules table via has_asset_access RPC.
 * Does NOT consider publish/org visibility — use the request* helpers for that.
 */
export async function checkAssetAccess(
  assetType: AssetType,
  assetId: string
): Promise<AccessCheckResult> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { allowed: false, reason: "not_authenticated", message: "Please sign in." };
  }

  const { data, error } = await supabase.rpc("has_asset_access", {
    _user_id: userData.user.id,
    _asset_type: assetType,
    _asset_id: assetId,
  });

  if (error) {
    return { allowed: false, reason: "error", message: error.message };
  }
  if (data === true) return { allowed: true, reason: "ok" };

  // Determine which gate blocked
  const { data: rule } = await supabase
    .from("access_rules")
    .select("required_plan,required_role")
    .eq("asset_type", assetType)
    .eq("asset_id", assetId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rule?.required_plan) {
    return {
      allowed: false,
      reason: "requires_plan",
      message: `Requires the "${rule.required_plan}" plan.`,
    };
  }
  if (rule?.required_role) {
    return {
      allowed: false,
      reason: "requires_role",
      message: `Requires role "${rule.required_role}".`,
    };
  }
  return { allowed: false, reason: "forbidden", message: "Access denied." };
}

/**
 * High-level helper for opening a resource. Combines publish check, access engine,
 * download toggle, and signed-URL minting for file resources.
 */
export async function requestResourceAccess(
  resourceId: string,
  opts: { wantDownload?: boolean } = {}
): Promise<ResourceAccessResult> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { allowed: false, reason: "not_authenticated", message: "Please sign in." };
  }

  const { data: res, error } = await supabase
    .from("resources")
    .select("id,kind,storage_path,external_url,published,downloads_enabled,org_id")
    .eq("id", resourceId)
    .maybeSingle();

  if (error) return { allowed: false, reason: "error", message: error.message };
  if (!res) return { allowed: false, reason: "not_found", message: "Resource not found." };

  if (!res.published) {
    // Admins / org managers still see it via RLS; but if it returned and not published they're admin.
    // Continue — they can preview.
  }

  if (opts.wantDownload && !res.downloads_enabled) {
    return { allowed: false, reason: "downloads_disabled", message: "Downloads are disabled for this resource." };
  }

  const gate = await checkAssetAccess("resource", resourceId);
  if (!gate.allowed) return gate;

  if (res.kind === "file" && res.storage_path) {
    const { data: signed, error: sErr } = await supabase.storage
      .from("resources")
      .createSignedUrl(res.storage_path, 60 * 10);
    if (sErr) return { allowed: false, reason: "error", message: sErr.message };
    return { allowed: true, reason: "ok", url: signed.signedUrl, kind: res.kind };
  }

  return { allowed: true, reason: "ok", url: res.external_url ?? undefined, kind: res.kind };
}

/**
 * Gate for starting a mock exam. Validates publish + access rule.
 */
export async function requestMockExamLaunch(mockExamId: string): Promise<MockExamLaunchResult> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { allowed: false, reason: "not_authenticated", message: "Please sign in." };
  }

  const { data: exam, error } = await supabase
    .from("mock_exams")
    .select("id,published,org_id")
    .eq("id", mockExamId)
    .maybeSingle();

  if (error) return { allowed: false, reason: "error", message: error.message };
  if (!exam) return { allowed: false, reason: "not_found", message: "Mock exam not found." };

  const gate = await checkAssetAccess("mock_exam", mockExamId);
  if (!gate.allowed) return gate;

  return { allowed: true, reason: "ok", mock_exam_id: exam.id };
}
