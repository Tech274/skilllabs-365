import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  if (!res.ok) throw new Error(`Azure auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID")!;
    const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
    const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
    const AZURE_SUBSCRIPTION_ID = Deno.env.get("AZURE_SUBSCRIPTION_ID")!;

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!hasAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

    // Fetch compute usage for East US (primary region)
    const regions = ["eastus", "centralindia"];
    const quotaData: Record<string, any> = {};

    for (const region of regions) {
      const res = await fetch(
        `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`,
        { headers: { Authorization: `Bearer ${azureToken}` } }
      );

      if (res.ok) {
        const data = await res.json();
        const usages = data.value || [];

        // Extract key VM family quotas
        const families = ["standardBSFamily", "standardDSv2Family", "standardDSv3Family", "cores"];
        const regionQuota: any[] = [];

        for (const usage of usages) {
          const name = usage.name?.value || "";
          if (families.includes(name) || name === "cores") {
            regionQuota.push({
              name: usage.name?.localizedValue || name,
              currentUsage: usage.currentValue || 0,
              limit: usage.limit || 0,
              unit: usage.unit || "Count",
            });
          }
        }

        quotaData[region] = regionQuota;
      } else {
        quotaData[region] = [];
      }
    }

    // Also get DB VM counts by status
    const { data: vmCounts } = await supabase
      .from("virtual_machines")
      .select("status");

    const statusCounts: Record<string, number> = {};
    if (vmCounts) {
      for (const vm of vmCounts) {
        statusCounts[vm.status] = (statusCounts[vm.status] || 0) + 1;
      }
    }

    return new Response(
      JSON.stringify({ quotas: quotaData, vm_status_counts: statusCounts }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("azure-quota error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
