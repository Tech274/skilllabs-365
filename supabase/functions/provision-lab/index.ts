import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Get Azure access token using Service Principal */
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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure auth failed [${res.status}]: ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}

/** Create an Azure VM */
async function createAzureVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  options: {
    region: string;
    vmSize: string;
    osImage: string;
    adminUsername: string;
    adminPassword: string;
    subnetId: string;
  }
): Promise<{ vmId: string; privateIp: string }> {
  const apiVersion = "2024-03-01";
  const nicName = `${vmName}-nic`;

  // 1. Create NIC
  const nicRes = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=${apiVersion}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        location: options.region,
        properties: {
          ipConfigurations: [
            {
              name: "ipconfig1",
              properties: {
                subnet: { id: options.subnetId },
                privateIPAllocationMethod: "Dynamic",
              },
            },
          ],
        },
        tags: { managedBy: "skilllabs", purpose: "lab-vm" },
      }),
    }
  );

  if (!nicRes.ok) {
    const body = await nicRes.text();
    throw new Error(`Failed to create NIC [${nicRes.status}]: ${body}`);
  }

  const nicData = await nicRes.json();
  const nicId = nicData.id;

  // Wait for NIC provisioning
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 2. Determine OS image reference
  const isWindows = options.osImage.toLowerCase().includes("windows");
  const imageReference = isWindows
    ? {
        publisher: "MicrosoftWindowsServer",
        offer: "WindowsServer",
        sku: "2022-datacenter-azure-edition",
        version: "latest",
      }
    : {
        publisher: "Canonical",
        offer: "0001-com-ubuntu-server-jammy",
        sku: "22_04-lts-gen2",
        version: "latest",
      };

  // 3. Create VM
  const vmPayload: Record<string, unknown> = {
    location: options.region,
    properties: {
      hardwareProfile: { vmSize: options.vmSize },
      storageProfile: {
        imageReference,
        osDisk: {
          createOption: "FromImage",
          managedDisk: { storageAccountType: "Standard_LRS" },
          deleteOption: "Delete",
        },
      },
      osProfile: {
        computerName: vmName.substring(0, 15),
        adminUsername: options.adminUsername,
        adminPassword: options.adminPassword,
        ...(isWindows
          ? { windowsConfiguration: { enableAutomaticUpdates: false, provisionVMAgent: true } }
          : { linuxConfiguration: { disablePasswordAuthentication: false } }),
      },
      networkProfile: {
        networkInterfaces: [{ id: nicId, properties: { primary: true, deleteOption: "Delete" } }],
      },
      diagnosticsProfile: {
        bootDiagnostics: { enabled: false },
      },
    },
    tags: { managedBy: "skilllabs", purpose: "lab-vm" },
  };

  const vmRes = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=${apiVersion}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vmPayload),
    }
  );

  if (!vmRes.ok) {
    const body = await vmRes.text();
    throw new Error(`Failed to create VM [${vmRes.status}]: ${body}`);
  }

  const vmData = await vmRes.json();

  // 4. Get private IP from NIC
  const nicGetRes = await fetch(
    `https://management.azure.com${nicId}?api-version=${apiVersion}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const nicGetData = await nicGetRes.json();
  const privateIp =
    nicGetData?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress || "pending";

  return {
    vmId: vmData.id || vmData.name,
    privateIp,
  };
}

/** Poll Azure VM until it's running (max 5 minutes) */
async function waitForVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<string> {
  const apiVersion = "2024-03-01";
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/instanceView?api-version=${apiVersion}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (res.ok) {
      const data = await res.json();
      const statuses = data.statuses || [];
      const powerState = statuses.find((s: { code: string }) => s.code.startsWith("PowerState/"));
      if (powerState?.code === "PowerState/running") {
        return "running";
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  return "timeout";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Required secrets
    const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID");
    const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID");
    const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET");
    const AZURE_SUBSCRIPTION_ID = Deno.env.get("AZURE_SUBSCRIPTION_ID");
    const AZURE_RESOURCE_GROUP = Deno.env.get("AZURE_RESOURCE_GROUP") || "skilllabs-rg";
    const AZURE_SUBNET_ID = Deno.env.get("AZURE_SUBNET_ID") || "";
    const AZURE_VM_ADMIN_USERNAME = Deno.env.get("AZURE_VM_ADMIN_USERNAME") || "labadmin";
    const AZURE_VM_ADMIN_PASSWORD = Deno.env.get("AZURE_VM_ADMIN_PASSWORD") || "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!AZURE_TENANT_ID) throw new Error("AZURE_TENANT_ID is not configured");
    if (!AZURE_CLIENT_ID) throw new Error("AZURE_CLIENT_ID is not configured");
    if (!AZURE_CLIENT_SECRET) throw new Error("AZURE_CLIENT_SECRET is not configured");
    if (!AZURE_SUBSCRIPTION_ID) throw new Error("AZURE_SUBSCRIPTION_ID is not configured");
    if (!AZURE_SUBNET_ID) throw new Error("AZURE_SUBNET_ID is not configured");
    if (!AZURE_VM_ADMIN_PASSWORD) throw new Error("AZURE_VM_ADMIN_PASSWORD is not configured");
    if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization header");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");
    const userId = user.id;

    const body = await req.json();
    const { lab_template_id } = body;
    if (!lab_template_id) throw new Error("lab_template_id is required");

    // Fetch lab template
    const { data: template, error: templateError } = await supabase
      .from("lab_templates")
      .select("*")
      .eq("id", lab_template_id)
      .maybeSingle();

    if (templateError || !template) {
      throw new Error(`Lab template not found: ${templateError?.message || lab_template_id}`);
    }

    // Determine region mapping
    const regionMap: Record<string, string> = {
      "East US": "eastus",
      "West US": "westus2",
      "Central India": "centralindia",
      "West Europe": "westeurope",
      "Southeast Asia": "southeastasia",
    };
    const azureRegion = regionMap[template.region] || "eastus";

    // Generate unique VM name
    const vmName = `lab-${template.id.substring(0, 8)}-${Date.now().toString(36)}`;

    // 1. Register VM in database as provisioning
    const { data: vmRecord, error: vmInsertError } = await supabase
      .from("virtual_machines")
      .insert({
        user_id: userId,
        lab_template_id: template.id,
        region: template.region === "All Regions" ? "East US" : template.region,
        vm_size: template.vm_size,
        status: "provisioning",
        expires_at: new Date(Date.now() + template.duration * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (vmInsertError) throw new Error(`Failed to register VM: ${vmInsertError.message}`);

    // 2. Get Azure auth token
    const azureToken = await getAzureToken(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

    // 3. Create Azure VM
    let vmResult: { vmId: string; privateIp: string };
    try {
      vmResult = await createAzureVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName, {
        region: azureRegion,
        vmSize: template.vm_size,
        osImage: template.os_image,
        adminUsername: AZURE_VM_ADMIN_USERNAME,
        adminPassword: AZURE_VM_ADMIN_PASSWORD,
        subnetId: AZURE_SUBNET_ID,
      });
    } catch (azureError) {
      // Update DB record to failed
      await supabase
        .from("virtual_machines")
        .update({ status: "failed" })
        .eq("id", vmRecord.id);
      throw azureError;
    }

    // 4. Update VM record with Azure details
    await supabase
      .from("virtual_machines")
      .update({
        azure_vm_id: vmResult.vmId,
        private_ip: vmResult.privateIp,
        status: "provisioning",
      })
      .eq("id", vmRecord.id);

    // 5. Poll until VM is running — but respond within 25s to avoid client timeout
    const vmStatus = await Promise.race([
      waitForVM(azureToken, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, vmName),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 20000)),
    ]);

    if (vmStatus === "running") {
      await supabase
        .from("virtual_machines")
        .update({
          status: "running",
          private_ip: vmResult.privateIp,
        })
        .eq("id", vmRecord.id);
    }

    return new Response(
      JSON.stringify({
        vm_id: vmRecord.id,
        azure_vm_id: vmResult.vmId,
        private_ip: vmResult.privateIp,
        status: vmStatus === "running" ? "running" : "provisioning",
        vm_name: vmName,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("provision-lab error:", error);
    const rawMessage = error instanceof Error ? error.message : "Unknown error";

    // Parse user-friendly error message
    let userMessage = rawMessage;
    if (rawMessage.includes("exceeding approved") && rawMessage.includes("Cores quota")) {
      userMessage = "Azure VM quota exceeded. All available compute cores are in use. Please stop or delete unused VMs, or contact your administrator to increase the quota.";
    } else if (rawMessage.includes("OperationNotAllowed")) {
      userMessage = "This operation is not currently allowed by Azure. Please try again later or contact your administrator.";
    } else if (rawMessage.includes("Azure auth failed")) {
      userMessage = "Azure authentication failed. Please contact your administrator.";
    }

    return new Response(
      JSON.stringify({ error: userMessage }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
