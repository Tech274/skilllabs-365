// Client-side readiness flow: admin Resolve re-validation, realtime student
// updates, provider preflight messaging and artifact-download RBAC.
//
// These are thin, testable wrappers over the admin-only `readiness-admin` edge
// function so the same rules are exercised in tests and in the UI.
import { supabase } from "@/integrations/supabase/client";

export interface ReadinessBlocker { field: string; message: string }

export interface ReadinessResult {
  ready: boolean;
  provider: string;
  template_id: string;
  template_name: string | null;
  blockers: ReadinessBlocker[];
  provider_account_linked: boolean;
}

export interface ResolveOutcome {
  resolved: boolean;
  notified: number;
  readiness: ReadinessResult | null;
  error: string | null;
}

/** Runs the admin Resolve flow and normalises the re-validation outcome. */
export async function resolveReadinessBlock(templateId: string, note?: string): Promise<ResolveOutcome> {
  const { data, error } = await supabase.functions.invoke("readiness-admin", {
    body: { action: "resolve", template_id: templateId, note: note ?? null },
  });
  if (error) {
    return { resolved: false, notified: 0, readiness: null, error: error.message };
  }
  return {
    resolved: Boolean(data?.resolved),
    notified: Number(data?.notified ?? 0),
    readiness: (data?.readiness ?? null) as ReadinessResult | null,
    error: null,
  };
}

/** Realtime guard: does this notification mean a student panel should re-check? */
export function isReadinessResolvedNotification(payload: unknown): boolean {
  const row = (payload as { new?: { type?: string } } | null)?.new
    ?? (payload as { type?: string } | null);
  return (row as { type?: string } | null)?.type === "readiness_resolved";
}

export interface PreflightLike {
  ok: boolean;
  provider: string;
  account_name?: string | null;
  missing_fields?: string[];
  message?: string;
  suggestion?: string;
}

/**
 * Turns a provider preflight into an actionable message instead of a raw
 * ProviderConfigError, e.g. "SkillTrack AWS is missing: Secret access key".
 */
export function preflightErrorMessage(pre: PreflightLike): string | null {
  if (pre.ok) return null;
  const account = pre.account_name ?? `${pre.provider.toUpperCase()} resource provider`;
  const missing = (pre.missing_fields ?? []).join(", ");
  const base = missing
    ? `${account} is missing: ${missing}.`
    : `${account} is not usable yet.`;
  const tail = [pre.message, pre.suggestion].filter(Boolean).join(" ");
  return tail ? `${base} ${tail}` : base;
}

/** Server-side RBAC gate for binding artifact downloads (admins only). */
export async function canDownloadArtifact(
  artifactId: string,
  templateId?: string | null,
): Promise<{ allowed: boolean; error: string | null }> {
  const { data, error } = await supabase.functions.invoke("readiness-admin", {
    body: { action: "artifact_access", template_id: templateId ?? null, artifact: artifactId },
  });
  if (error) return { allowed: false, error: error.message };
  return { allowed: Boolean(data?.allowed), error: null };
}
