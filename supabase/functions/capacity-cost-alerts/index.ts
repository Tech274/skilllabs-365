// Cost & capacity alerting.
//
// Evaluates active session/VM counts and estimated spend per region against
// admin-configured thresholds (platform_settings → capacity_cost_alerts) and
// notifies every platform admin when a threshold is approached or exceeded.
// Runs from cron (x-cron-secret) or on demand from the admin UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeadersFor, jsonResponse, errorResponse, requireAdmin } from "../_shared/auth.ts";

const SETTINGS_KEY = "capacity_cost_alerts";
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

const VM_HOURLY_RATES: Record<string, number> = {
  Standard_B1s: 0.0104,
  Standard_B1ms: 0.0207,
  Standard_B2s: 0.0416,
  Standard_B2ms: 0.0832,
  Standard_B4ms: 0.166,
  Standard_D2s_v3: 0.096,
  Standard_D4s_v3: 0.192,
  Standard_D2as_v5: 0.077,
  Standard_D4as_v5: 0.154,
  Standard_E2s_v3: 0.126,
  Standard_F2s_v2: 0.085,
};
const DEFAULT_RATE = 0.05;

export interface AlertSettings {
  enabled: boolean;
  maxActiveSessions: number;
  warnAtPercent: number;
  dailySpendLimitUsd: number;
  regions: { region: string; maxActiveVms: number | null; dailySpendLimitUsd: number | null }[];
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  maxActiveSessions: 25,
  warnAtPercent: 80,
  dailySpendLimitUsd: 50,
  regions: [],
};

export function normalizeAlertSettings(value: unknown): AlertSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number, min = 0) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const regions = Array.isArray(v.regions)
    ? (v.regions as Record<string, unknown>[])
      .filter((r) => typeof r?.region === "string" && String(r.region).trim())
      .map((r) => ({
        region: String(r.region).trim(),
        maxActiveVms: Number.isFinite(Number(r.max_active_vms)) && Number(r.max_active_vms) > 0
          ? Number(r.max_active_vms)
          : null,
        dailySpendLimitUsd: Number.isFinite(Number(r.daily_spend_limit_usd)) && Number(r.daily_spend_limit_usd) > 0
          ? Number(r.daily_spend_limit_usd)
          : null,
      }))
    : [];

  return {
    enabled: v.enabled !== false,
    maxActiveSessions: num(v.max_active_sessions, DEFAULT_ALERT_SETTINGS.maxActiveSessions, 1),
    warnAtPercent: Math.min(100, Math.max(10, num(v.warn_at_percent, DEFAULT_ALERT_SETTINGS.warnAtPercent, 10))),
    dailySpendLimitUsd: num(v.daily_spend_limit_usd, DEFAULT_ALERT_SETTINGS.dailySpendLimitUsd, 0),
    regions,
  };
}

interface Candidate {
  kind: "capacity" | "cost";
  region: string | null;
  metric: string;
  value: number;
  threshold: number;
  severity: "warning" | "critical";
  message: string;
}

export function evaluateThresholds(input: {
  settings: AlertSettings;
  activeSessions: number;
  vmsByRegion: Record<string, number>;
  spendByRegion: Record<string, number>;
}): Candidate[] {
  const { settings, activeSessions, vmsByRegion, spendByRegion } = input;
  const out: Candidate[] = [];
  const warnRatio = settings.warnAtPercent / 100;

  if (settings.maxActiveSessions > 0) {
    const ratio = activeSessions / settings.maxActiveSessions;
    if (ratio >= 1) {
      out.push({
        kind: "capacity", region: null, metric: "active_sessions", value: activeSessions,
        threshold: settings.maxActiveSessions, severity: "critical",
        message: `Active sessions reached the platform limit (${activeSessions}/${settings.maxActiveSessions}).`,
      });
    } else if (ratio >= warnRatio) {
      out.push({
        kind: "capacity", region: null, metric: "active_sessions", value: activeSessions,
        threshold: settings.maxActiveSessions, severity: "warning",
        message: `Active sessions are at ${Math.round(ratio * 100)}% of the platform limit (${activeSessions}/${settings.maxActiveSessions}).`,
      });
    }
  }

  const totalSpend = Object.values(spendByRegion).reduce((a, b) => a + b, 0);
  if (settings.dailySpendLimitUsd > 0) {
    const ratio = totalSpend / settings.dailySpendLimitUsd;
    if (ratio >= 1) {
      out.push({
        kind: "cost", region: null, metric: "daily_spend_usd", value: Number(totalSpend.toFixed(2)),
        threshold: settings.dailySpendLimitUsd, severity: "critical",
        message: `Estimated spend today ($${totalSpend.toFixed(2)}) exceeded the daily limit of $${settings.dailySpendLimitUsd}.`,
      });
    } else if (ratio >= warnRatio) {
      out.push({
        kind: "cost", region: null, metric: "daily_spend_usd", value: Number(totalSpend.toFixed(2)),
        threshold: settings.dailySpendLimitUsd, severity: "warning",
        message: `Estimated spend today ($${totalSpend.toFixed(2)}) is at ${Math.round(ratio * 100)}% of the $${settings.dailySpendLimitUsd} daily limit.`,
      });
    }
  }

  for (const rule of settings.regions) {
    const vms = vmsByRegion[rule.region] ?? 0;
    const spend = spendByRegion[rule.region] ?? 0;
    if (rule.maxActiveVms) {
      const ratio = vms / rule.maxActiveVms;
      if (ratio >= warnRatio) {
        out.push({
          kind: "capacity", region: rule.region, metric: "active_vms", value: vms,
          threshold: rule.maxActiveVms, severity: ratio >= 1 ? "critical" : "warning",
          message: `${rule.region}: ${vms} active VM(s) against a capacity of ${rule.maxActiveVms}.`,
        });
      }
    }
    if (rule.dailySpendLimitUsd) {
      const ratio = spend / rule.dailySpendLimitUsd;
      if (ratio >= warnRatio) {
        out.push({
          kind: "cost", region: rule.region, metric: "daily_spend_usd", value: Number(spend.toFixed(2)),
          threshold: rule.dailySpendLimitUsd, severity: ratio >= 1 ? "critical" : "warning",
          message: `${rule.region}: estimated spend today $${spend.toFixed(2)} against a $${rule.dailySpendLimitUsd} limit.`,
        });
      }
    }
  }

  return out;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!isCron) {
      const auth = await requireAdmin(req);
      if (auth instanceof Response) return auth;
    }

    const admin = serviceClient();
    const { data: settingRow } = await admin
      .from("platform_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const settings = normalizeAlertSettings(settingRow?.value);

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const { count: activeSessions } = await admin
      .from("sessions").select("id", { count: "exact", head: true }).eq("status", "active");

    const { data: vms } = await admin
      .from("virtual_machines")
      .select("region, vm_size, status, created_at")
      .in("status", ["provisioning", "starting", "running", "idle"]);

    const { data: todaysVms } = await admin
      .from("virtual_machines")
      .select("region, vm_size, created_at, updated_at, status")
      .gte("created_at", dayStart.toISOString());

    const vmsByRegion: Record<string, number> = {};
    for (const vm of vms ?? []) {
      const region = vm.region ?? "unknown";
      vmsByRegion[region] = (vmsByRegion[region] ?? 0) + 1;
    }

    const spendByRegion: Record<string, number> = {};
    for (const vm of todaysVms ?? []) {
      const region = vm.region ?? "unknown";
      const rate = VM_HOURLY_RATES[vm.vm_size] ?? DEFAULT_RATE;
      const start = new Date(vm.created_at).getTime();
      const end = ["running", "idle", "provisioning", "starting"].includes(vm.status)
        ? Date.now()
        : new Date(vm.updated_at ?? vm.created_at).getTime();
      const hours = Math.max(0, (end - start) / 3_600_000);
      spendByRegion[region] = (spendByRegion[region] ?? 0) + hours * rate;
    }

    const metrics = {
      active_sessions: activeSessions ?? 0,
      vms_by_region: vmsByRegion,
      spend_by_region: Object.fromEntries(
        Object.entries(spendByRegion).map(([k, v]) => [k, Number(v.toFixed(2))]),
      ),
      settings,
    };

    if (!settings.enabled) {
      return jsonResponse({ evaluated: 0, alerts: [], skipped: "alerts_disabled", metrics });
    }

    const candidates = evaluateThresholds({
      settings,
      activeSessions: activeSessions ?? 0,
      vmsByRegion,
      spendByRegion,
    });

    // Deduplicate: skip anything already raised within the cooldown window.
    const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();
    const { data: recent } = await admin
      .from("capacity_cost_alerts").select("metric, region, severity").gte("created_at", since);
    const seen = new Set((recent ?? []).map((r: Record<string, unknown>) => `${r.metric}|${r.region ?? ""}|${r.severity}`));
    const fresh = candidates.filter((c) => !seen.has(`${c.metric}|${c.region ?? ""}|${c.severity}`));

    const { data: admins } = await admin
      .from("user_roles").select("user_id").in("role", ["admin", "super_admin"]);
    const adminIds = [...new Set((admins ?? []).map((r: { user_id: string }) => r.user_id))];

    for (const alert of fresh) {
      await admin.from("capacity_cost_alerts").insert({
        kind: alert.kind,
        region: alert.region,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        severity: alert.severity,
        message: alert.message,
        notified: adminIds.length,
      });
      if (adminIds.length) {
        await admin.from("notifications").insert(adminIds.map((id) => ({
          user_id: id,
          type: alert.kind === "cost" ? "cost_threshold" : "capacity_threshold",
          title: alert.severity === "critical"
            ? `${alert.kind === "cost" ? "Spend" : "Capacity"} limit exceeded`
            : `${alert.kind === "cost" ? "Spend" : "Capacity"} approaching limit`,
          message: alert.message,
        })));
      }
    }

    return jsonResponse({ evaluated: candidates.length, raised: fresh.length, alerts: fresh, metrics });
  } catch (e) {
    console.error("capacity-cost-alerts error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
