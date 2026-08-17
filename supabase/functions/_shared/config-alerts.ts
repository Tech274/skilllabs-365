// Proactive admin alerting for cloud misconfiguration detected at preflight.
//
// When the Azure preflight reports SubscriptionNotFound, AuthorizationFailed,
// an invalid client secret, etc., every platform admin gets an in-app
// notification that names the exact setting to update. Deduplicated per
// (code, setting) within a cooldown window so a burst of failed launches does
// not spam the bell.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const CONFIG_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

export interface ConfigAlert {
  provider: "azure" | "aws";
  code: string;
  setting: string;
  message: string;
  suggestion?: string;
  /** Where the problem surfaced, e.g. "provision-lab preflight". */
  context?: string;
}

export function configAlertType(alert: ConfigAlert): string {
  const slug = `${alert.provider}_${alert.code}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `cloud_config_${slug}`;
}

export function configAlertTitle(alert: ConfigAlert): string {
  const label = alert.provider === "azure" ? "Azure" : "AWS";
  return `${label} configuration problem: ${alert.setting}`;
}

export function configAlertMessage(alert: ConfigAlert): string {
  const parts = [alert.message.trim()];
  parts.push(`Setting to update: ${alert.setting}.`);
  if (alert.suggestion) parts.push(alert.suggestion.trim());
  parts.push("Fix it in Admin → Cloud Providers, then run the configuration test.");
  if (alert.context) parts.push(`(Detected during ${alert.context}.)`);
  return parts.join(" ");
}

export async function notifyConfigIssue(
  supabase: SupabaseClient,
  alert: ConfigAlert,
): Promise<{ sent: boolean; recipients: number; reason?: string }> {
  const type = configAlertType(alert);
  const since = new Date(Date.now() - CONFIG_ALERT_COOLDOWN_MS).toISOString();

  try {
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("type", type)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      return { sent: false, recipients: 0, reason: "deduplicated" };
    }

    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);

    const unique = [...new Set((admins ?? []).map((a: { user_id: string }) => a.user_id))];
    if (unique.length === 0) return { sent: false, recipients: 0, reason: "no_admins" };

    const title = configAlertTitle(alert);
    const message = configAlertMessage(alert);

    const { error } = await supabase.from("notifications").insert(
      unique.map((user_id) => ({ user_id, title, message, type })),
    );
    if (error) return { sent: false, recipients: 0, reason: error.message };

    console.error(`[config-alert] ${title} :: ${alert.code} :: ${alert.setting}`);
    return { sent: true, recipients: unique.length };
  } catch (e) {
    return { sent: false, recipients: 0, reason: e instanceof Error ? e.message : "unknown" };
  }
}
