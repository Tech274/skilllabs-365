// Per-user and per-organization AI usage quotas.
// Enforced BEFORE any provider call so bursts and runaway cost are stopped
// at the edge instead of at the gateway.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type QuotaRow = {
  scope: "user" | "org" | "global";
  scope_id: string | null;
  per_minute_limit: number;
  daily_limit: number;
  active: boolean;
};

export type QuotaDecision = {
  allowed: boolean;
  scope?: "user" | "org" | "global";
  window?: "minute" | "day";
  limit?: number;
  used?: number;
  retryAfterSeconds?: number;
  message?: string;
};

export const DEFAULT_USER_PER_MINUTE = 10;
export const DEFAULT_USER_DAILY = 200;

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Pure check of one quota row against observed usage counts. */
export function evaluateQuota(
  quota: Pick<QuotaRow, "scope" | "per_minute_limit" | "daily_limit">,
  usedLastMinute: number,
  usedToday: number,
): QuotaDecision {
  if (quota.per_minute_limit > 0 && usedLastMinute >= quota.per_minute_limit) {
    return {
      allowed: false,
      scope: quota.scope,
      window: "minute",
      limit: quota.per_minute_limit,
      used: usedLastMinute,
      retryAfterSeconds: 60,
      message: `AI rate limit reached (${quota.per_minute_limit} requests/minute for this ${quota.scope}). Please try again in a minute.`,
    };
  }
  if (quota.daily_limit > 0 && usedToday >= quota.daily_limit) {
    return {
      allowed: false,
      scope: quota.scope,
      window: "day",
      limit: quota.daily_limit,
      used: usedToday,
      retryAfterSeconds: 3600,
      message: `Daily AI usage cap reached (${quota.daily_limit} requests/day for this ${quota.scope}). Access resets tomorrow.`,
    };
  }
  return { allowed: true };
}

/** Resolve the caller's primary organization, if any. */
export async function resolveOrgId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (!userId || userId === "00000000-0000-0000-0000-000000000000") return null;
  const { data } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/**
 * Enforce user, org and global quotas. Fails open on infrastructure errors so
 * a quota lookup problem never takes the AI features down.
 */
export async function enforceAiQuota(
  userId: string,
  opts: { isServiceRole?: boolean } = {},
): Promise<QuotaDecision & { orgId: string | null }> {
  if (opts.isServiceRole) return { allowed: true, orgId: null };

  try {
    const supabase = serviceClient();
    const orgId = await resolveOrgId(supabase, userId);

    const scopes: Array<{ scope: "user" | "org" | "global"; id: string | null }> = [
      { scope: "user", id: userId },
      ...(orgId ? [{ scope: "org" as const, id: orgId }] : []),
      { scope: "global", id: null },
    ];

    const { data: quotaRows } = await supabase
      .from("ai_usage_quotas")
      .select("scope, scope_id, per_minute_limit, daily_limit, active")
      .eq("active", true);
    const quotas = (quotaRows ?? []) as QuotaRow[];

    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    for (const target of scopes) {
      let quota = quotas.find(
        (q) => q.scope === target.scope && (q.scope_id ?? null) === target.id,
      );
      if (!quota && target.scope === "user") {
        // Default guardrail when no explicit user quota exists.
        quota = {
          scope: "user",
          scope_id: userId,
          per_minute_limit: DEFAULT_USER_PER_MINUTE,
          daily_limit: DEFAULT_USER_DAILY,
          active: true,
        };
      }
      if (!quota) continue;

      const column = target.scope === "org" ? "org_id" : "user_id";
      if (target.scope === "global") {
        const [{ count: minuteCount }, { count: dayCount }] = await Promise.all([
          supabase.from("ai_request_logs").select("id", { count: "exact", head: true })
            .gte("created_at", minuteAgo),
          supabase.from("ai_request_logs").select("id", { count: "exact", head: true })
            .gte("created_at", dayAgo),
        ]);
        const decision = evaluateQuota(quota, minuteCount ?? 0, dayCount ?? 0);
        if (!decision.allowed) return { ...decision, orgId };
        continue;
      }

      const value = target.id!;
      const [{ count: minuteCount }, { count: dayCount }] = await Promise.all([
        supabase.from("ai_request_logs").select("id", { count: "exact", head: true })
          .eq(column, value).gte("created_at", minuteAgo),
        supabase.from("ai_request_logs").select("id", { count: "exact", head: true })
          .eq(column, value).gte("created_at", dayAgo),
      ]);
      const decision = evaluateQuota(quota, minuteCount ?? 0, dayCount ?? 0);
      if (!decision.allowed) return { ...decision, orgId };
    }

    return { allowed: true, orgId };
  } catch (e) {
    console.error("[ai-quota] check failed, allowing request:", e instanceof Error ? e.message : e);
    return { allowed: true, orgId: null };
  }
}
