// Admin alerting for AI provider outages / degraded latency.
// Sends an optional webhook (AI_ALERT_WEBHOOK_URL) and creates in-app
// notifications for every platform admin. Deduplicated per cooldown window.
// Every delivery attempt is recorded in public.ai_alert_deliveries.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** Latency above this (ms) on a successful health probe counts as degraded. */
export const DEGRADED_LATENCY_MS = 8000;
/** Don't re-alert the same condition more often than this. */
export const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export type AiAlert = {
  status: string;
  message: string;
  latencyMs: number | null;
  model: string;
};

export type DeliveryChannel = "in_app" | "webhook";
export type DeliveryStatus = "sent" | "failed" | "deduplicated" | "skipped";

export function shouldAlert(status: string, latencyMs: number | null): boolean {
  if (status !== "healthy") return true;
  return latencyMs !== null && latencyMs > DEGRADED_LATENCY_MS;
}

export function alertTitle(status: string, latencyMs: number | null): string {
  if (status === "healthy") return "AI provider latency degraded";
  if (status === "misconfigured") return "AI provider misconfigured";
  if (status === "no_credits") return "AI credits exhausted";
  if (status === "rate_limited") return "AI provider rate limited";
  if (status === "unreachable") return "AI provider unreachable";
  return "AI provider degraded";
}

async function recordDelivery(
  supabase: SupabaseClient,
  row: {
    alert: AiAlert;
    title: string;
    channel: DeliveryChannel;
    deliveryStatus: DeliveryStatus;
    recipients?: number;
    detail?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("ai_alert_deliveries").insert({
      alert_title: row.title,
      alert_status: row.alert.status,
      channel: row.channel,
      delivery_status: row.deliveryStatus,
      recipients: row.recipients ?? 0,
      latency_ms: row.alert.latencyMs !== null ? Math.round(row.alert.latencyMs) : null,
      model: row.alert.model,
      detail: row.detail ?? null,
    });
  } catch (e) {
    console.error("[ai-alert] failed to record delivery:", e instanceof Error ? e.message : e);
  }
}

export async function sendAiAlert(alert: AiAlert): Promise<{ sent: boolean; reason?: string }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const title = alertTitle(alert.status, alert.latencyMs);
  const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();

  // Cooldown: skip if the same alert already went out recently.
  const { data: recent } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", "ai_alert")
    .eq("title", title)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) {
    await recordDelivery(supabase, {
      alert,
      title,
      channel: "in_app",
      deliveryStatus: "deduplicated",
      detail: "Suppressed by 15 minute cooldown window",
    });
    return { sent: false, reason: "cooldown" };
  }

  const body = alert.latencyMs !== null
    ? `${alert.message} (model ${alert.model}, ${Math.round(alert.latencyMs)}ms)`
    : `${alert.message} (model ${alert.model})`;

  // In-app notification for every platform admin.
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "super_admin"]);

  const uniqueAdmins = Array.from(new Set((admins ?? []).map((a: { user_id: string }) => a.user_id)));
  if (uniqueAdmins.length > 0) {
    const { error } = await supabase.from("notifications").insert(
      uniqueAdmins.map((user_id) => ({
        user_id,
        type: "ai_alert",
        title,
        message: body,
      })),
    );
    await recordDelivery(supabase, {
      alert,
      title,
      channel: "in_app",
      deliveryStatus: error ? "failed" : "sent",
      recipients: error ? 0 : uniqueAdmins.length,
      detail: error?.message ?? null,
    });
  } else {
    await recordDelivery(supabase, {
      alert,
      title,
      channel: "in_app",
      deliveryStatus: "skipped",
      detail: "No platform admins to notify",
    });
  }

  // Optional outbound webhook (Slack / PagerDuty / e-mail relay).
  const webhook = Deno.env.get("AI_ALERT_WEBHOOK_URL")?.trim();
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `[SkillTrack-365] ${title}: ${body}`,
          status: alert.status,
          model: alert.model,
          latency_ms: alert.latencyMs,
          at: new Date().toISOString(),
        }),
      });
      await recordDelivery(supabase, {
        alert,
        title,
        channel: "webhook",
        deliveryStatus: res.ok ? "sent" : "failed",
        recipients: res.ok ? 1 : 0,
        detail: res.ok ? null : `Webhook responded ${res.status}`,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[ai-alert] webhook failed:", detail);
      await recordDelivery(supabase, {
        alert,
        title,
        channel: "webhook",
        deliveryStatus: "failed",
        detail,
      });
    }
  } else {
    await recordDelivery(supabase, {
      alert,
      title,
      channel: "webhook",
      deliveryStatus: "skipped",
      detail: "AI_ALERT_WEBHOOK_URL not configured",
    });
  }

  return { sent: true };
}
