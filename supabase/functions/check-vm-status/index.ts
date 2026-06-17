import { corsHeaders, requireUser, requireOwnerOrAdmin, errorResponse, jsonResponse } from "../_shared/auth.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID")!;
    const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
    const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
    const AZURE_SUBSCRIPTION_ID = Deno.env.get("AZURE_SUBSCRIPTION_ID")!;
    const AZURE_RESOURCE_GROUP = Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg";

    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const supabase = auth.supabase;

    const { vm_id } = await req.json();
    if (!vm_id) return errorResponse("vm_id is required", 400);

    // Get VM record
    const { data: vm } = await supabase.from("virtual_machines").select("*").eq("id", vm_id).maybeSingle();
    if (!vm) return errorResponse("VM not found", 404);

    const forbidden = await requireOwnerOrAdmin(auth, vm.user_id);
    if (forbidden) return forbidden;

    if (vm.status !== "provisioning") {
      return new Response(JSON.stringify({ status: vm.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract VM name from azure_vm_id
    const azureVmId = vm.azure_vm_id;
    if (!azureVmId) {
      return new Response(JSON.stringify({ status: "provisioning" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const vmName = azureVmId.split("/").pop()!;

    // Get Azure token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: AZURE_CLIENT_ID,
          client_secret: AZURE_CLIENT_SECRET,
          scope: "https://management.azure.com/.default",
        }),
      }
    );
    const tokenData = await tokenRes.json();
    const azureToken = tokenData.access_token;

    // Check VM instance view
    const ivRes = await fetch(
      `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${vmName}/instanceView?api-version=2024-03-01`,
      { headers: { Authorization: `Bearer ${azureToken}` } }
    );

    if (!ivRes.ok) {
      return new Response(JSON.stringify({ status: "provisioning" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ivData = await ivRes.json();
    const statuses = ivData.statuses || [];
    const powerState = statuses.find((s: { code: string }) => s.code.startsWith("PowerState/"));

    if (powerState?.code === "PowerState/running") {
      // Get updated private IP
      const nicName = `${vmName}-nic`;
      const nicRes = await fetch(
        `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2024-03-01`,
        { headers: { Authorization: `Bearer ${azureToken}` } }
      );
      let privateIp = vm.private_ip;
      if (nicRes.ok) {
        const nicData = await nicRes.json();
        privateIp = nicData?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress || privateIp;
      }

      await supabase.from("virtual_machines").update({ status: "running", private_ip: privateIp }).eq("id", vm_id);
      return new Response(JSON.stringify({ status: "running", private_ip: privateIp }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "provisioning" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("check-vm-status error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
