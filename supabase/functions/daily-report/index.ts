import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import { corsHeadersFor, corsHeaders, requireAdmin } from "../_shared/auth.ts";


async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://management.azure.com/.default",
      }),
    }
  );
  if (!res.ok) throw new Error(`Azure auth failed`);
  return (await res.json()).access_token;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    // VM stats
    const { data: allVMs } = await supabase.from("virtual_machines").select("status, region, vm_size");
    const vmStatusCounts: Record<string, number> = {};
    const regionCounts: Record<string, number> = {};
    allVMs?.forEach((vm: any) => {
      vmStatusCounts[vm.status] = (vmStatusCounts[vm.status] || 0) + 1;
      regionCounts[vm.region] = (regionCounts[vm.region] || 0) + 1;
    });

    // Sessions today
    const { data: todaySessions } = await supabase
      .from("sessions")
      .select("id, status, started_at, ended_at")
      .gte("started_at", dayStart.toISOString());

    const sessionsStarted = todaySessions?.length || 0;
    const sessionsCompleted = todaySessions?.filter((s: any) => s.status === "completed").length || 0;

    // Quota check
    let quotaData: any = {};
    try {
      const azure = await resolveAzureRuntime(supabase, null);
      const azureToken = await getAzureToken(azure.tenantId, azure.clientId, azure.clientSecret);
      const regions = ["eastus"];
      for (const region of regions) {
        const res = await fetch(
          `https://management.azure.com/subscriptions/${azure.subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`,
          { headers: { Authorization: `Bearer ${azureToken}` } }
        );
        if (res.ok) {
          const data = await res.json();
          const relevant = data.value?.filter((u: any) =>
            ["cores", "standardBSFamily"].includes(u.name?.value)
          ).map((u: any) => ({
            name: u.name?.localizedValue || u.name?.value,
            current: u.currentValue,
            limit: u.limit,
            pct: u.limit > 0 ? Math.round((u.currentValue / u.limit) * 100) : 0,
          }));
          quotaData[region] = relevant || [];
        }
      }
    } catch (e) {
      quotaData = { error: String(e) };
    }

    // Cleanup actions taken today (count failed/terminated VMs created today)
    const { count: cleanedUpCount } = await supabase
      .from("virtual_machines")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "terminated"])
      .gte("updated_at", dayStart.toISOString());

    const reportData = {
      date: now.toISOString().split("T")[0],
      generated_at: now.toISOString(),
      vm_summary: {
        total: allVMs?.length || 0,
        by_status: vmStatusCounts,
        by_region: regionCounts,
      },
      sessions_today: {
        started: sessionsStarted,
        completed: sessionsCompleted,
      },
      quota: quotaData,
      cleanup: {
        vms_cleaned_today: cleanedUpCount || 0,
      },
    };

    // Insert report
    await supabase.from("daily_reports").insert({
      report_date: now.toISOString().split("T")[0],
      data: reportData,
    });

    // Send quota alert notifications to admins if > 80%
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminIds = adminRoles?.map((r: any) => r.user_id) || [];

    for (const [region, items] of Object.entries(quotaData)) {
      if (!Array.isArray(items)) continue;
      for (const q of items) {
        if (q.pct >= 80 && adminIds.length > 0) {
          const severity = q.pct >= 95 ? "critical" : "warning";
          const notifications = adminIds.map((uid: string) => ({
            user_id: uid,
            type: severity === "critical" ? "quota_critical" : "quota_warning",
            title: `${severity === "critical" ? "⚠️ Quota Critical" : "Quota Warning"}: ${q.name}`,
            message: `${region} — ${q.current}/${q.limit} cores used (${q.pct}%).${severity === "critical" ? " Students cannot launch new labs." : " Consider cleaning up unused VMs."}`,
          }));
          await supabase.from("notifications").insert(notifications);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, report: reportData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("daily-report error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
