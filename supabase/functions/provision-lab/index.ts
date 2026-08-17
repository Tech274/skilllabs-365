import { corsHeadersFor } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapAzureError } from "../_shared/vm-state.ts";
import { verifyAzureSubscription, detectConfigIssue } from "../_shared/azure-preflight.ts";
import { notifyConfigIssue } from "../_shared/config-alerts.ts";
import { correlationHeaders, correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, findInFlightVm, idempotencyKeyFrom, releaseIdempotency } from "../_shared/idempotency.ts";

const SOURCE = "provision-lab";



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



Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = correlationIdFrom(req);
  const traceHeaders = { ...corsHeaders, ...correlationHeaders(correlationId), "Content-Type": "application/json" };
  let timeline: ProvisioningTimeline | null = null;
  let idem: { key: string; userId: string } | null = null;
  // deno-lint-ignore no-explicit-any -- untyped service client (no generated DB types in the edge runtime)
  let admin: any = null;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    admin = service;
    const trace = new ProvisioningTimeline(service, { correlationId });
    timeline = trace;


    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization header");

    const supabase = service;

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");
    const userId = user.id;

    trace.attach({ userId });

    const body = await req.json();
    const { lab_template_id } = body;
    if (!lab_template_id) throw new Error("lab_template_id is required");
    trace.attach({ labTemplateId: lab_template_id });

    // --- Idempotency -------------------------------------------------------
    // 1. Explicit key (header `Idempotency-Key` or body `idempotency_key`):
    //    replays return the original response instead of provisioning again.
    const idemKey = idempotencyKeyFrom(req, body);
    const claim = await claimIdempotency(supabase, {
      key: idemKey,
      userId,
      action: "provision-lab",
      correlationId,
    });

    if (claim.outcome === "replay") {
      await trace.skipped(SOURCE, "idempotency", "Duplicate request replayed from stored result", { key: idemKey });
      return new Response(JSON.stringify({ ...claim.response, idempotent_replay: true }), {
        status: 200,
        headers: traceHeaders,
      });
    }
    if (claim.outcome === "in_progress") {
      await trace.skipped(SOURCE, "idempotency", "Duplicate request ignored while the first one is still running", { key: idemKey });
      return new Response(
        JSON.stringify({
          error: "A provisioning request with this idempotency key is already in progress.",
          correlation_id: claim.correlationId ?? correlationId,
          idempotent_replay: true,
        }),
        { status: 409, headers: traceHeaders },
      );
    }
    idem = { key: idemKey, userId };

    // 2. Key-independent guard: one in-flight VM per user per lab template, so
    //    a double click with two different keys still cannot create two VMs.
    const inFlight = await findInFlightVm(supabase, { userId, labTemplateId: lab_template_id });
    if (inFlight) {
      const reuse = {
        vm_id: inFlight.id,
        azure_vm_id: inFlight.azure_vm_id,
        private_ip: inFlight.private_ip,
        status: inFlight.status,
        reused_existing: true,
        correlation_id: correlationId,
      };
      trace.attach({ vmId: inFlight.id });
      await trace.skipped(SOURCE, "idempotency", "Existing VM for this lab reused instead of creating a duplicate", {
        vm_id: inFlight.id,
        status: inFlight.status,
      });
      await completeIdempotency(supabase, { key: idemKey, userId, action: "provision-lab", response: reuse });
      idem = null;
      return new Response(JSON.stringify(reuse), { status: 200, headers: traceHeaders });
    }

    // Budget cap check
    const { data: budgetSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "budget_cap")
      .maybeSingle();

    if (budgetSetting?.value) {
      const budget = budgetSetting.value as { enabled: boolean; period: string; amount: number };
      if (budget.enabled && budget.amount > 0) {
        const VM_COST_PER_HOUR: Record<string, number> = {
          "Standard_B2s": 0.0416, "Standard_B2ms": 0.0832, "Standard_B4ms": 0.166,
          "Standard_D2s_v3": 0.096, "Standard_D2as_v5": 0.077, "Standard_E2s_v3": 0.126,
        };

        // Calculate current spend in the budget period
        const now = new Date();
        const periodStart = budget.period === "daily"
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
          : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data: periodVMs } = await supabase
          .from("virtual_machines")
          .select("vm_size, created_at, status")
          .gte("created_at", periodStart);

        if (periodVMs) {
          let totalSpend = 0;
          for (const vm of periodVMs) {
            const hours = Math.max(0.5, (now.getTime() - new Date(vm.created_at).getTime()) / 3600000);
            const rate = VM_COST_PER_HOUR[vm.vm_size] || 0.05;
            totalSpend += hours * rate;
          }

          const pct = (totalSpend / budget.amount) * 100;

          // Send budget threshold notifications to all admins
          if (pct >= 80) {
            const { data: adminRoles } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("role", "admin");

            if (adminRoles && adminRoles.length > 0) {
              const thresholdKey = pct >= 100 ? "100" : "80";
              const title = pct >= 100
                ? `🚨 ${budget.period} budget limit reached`
                : `⚠️ ${budget.period} budget at ${Math.round(pct)}%`;
              const message = pct >= 100
                ? `Estimated ${budget.period} spend is $${totalSpend.toFixed(2)}, exceeding the $${budget.amount} cap. New lab launches are paused.`
                : `Estimated ${budget.period} spend is $${totalSpend.toFixed(2)} of $${budget.amount} (${Math.round(pct)}%). Consider reviewing active resources.`;

              // Deduplicate: only notify once per threshold per period
              const dedupeTag = `budget_${thresholdKey}_${budget.period}_${periodStart}`;
              for (const admin of adminRoles) {
                const { data: existing } = await supabase
                  .from("notifications")
                  .select("id")
                  .eq("user_id", admin.user_id)
                  .eq("type", dedupeTag)
                  .maybeSingle();

                if (!existing) {
                  await supabase.from("notifications").insert({
                    user_id: admin.user_id,
                    title,
                    message,
                    type: dedupeTag,
                  });
                }
              }
            }
          }

          if (totalSpend >= budget.amount) {
            throw new Error(
              `Budget cap reached: estimated ${budget.period} spend is $${totalSpend.toFixed(2)} (limit: $${budget.amount}). ` +
              "New lab launches are paused. Contact your administrator to increase the budget or clean up resources."
            );
          }
        }
      }
    }

    await trace.success(SOURCE, "budget-check", "Budget cap check passed");

    // Fetch lab template
    const { data: template, error: templateError } = await supabase
      .from("lab_templates")
      .select("*")
      .eq("id", lab_template_id)
      .maybeSingle();

    if (templateError || !template) {
      throw new Error(`Lab template not found: ${templateError?.message || lab_template_id}`);
    }

    // --- Resource Provider ------------------------------------------------
    // Every lab template must resolve to an active Azure account in the
    // Resource Providers registry (explicit selection or the provider default).
    // Without one we refuse to provision — no ambient/legacy credentials exist.
    if (template.provider && template.provider !== "azure") {
      return new Response(
        JSON.stringify({
          error: `Lab VM provisioning currently supports Azure resource providers only (template is set to ${template.provider}).`,
          setting: "Lab template → Resource provider",
          correlation_id: correlationId,
        }),
        { status: 400, headers: traceHeaders },
      );
    }

    await trace.start(SOURCE, "resource-provider", "Resolving resource provider account for this lab");
    let azure: AzureRuntime;
    try {
      azure = await resolveAzureRuntime(supabase, template.provider_account_id);
      assertVmProvisioningReady(azure);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Resource provider not configured";
      const setting = e instanceof ProviderConfigError ? e.setting : "Resource Providers";
      const suggestion = e instanceof ProviderConfigError ? e.suggestion : undefined;
      await trace.failed(SOURCE, "resource-provider", message, { setting });
      await notifyConfigIssue(service, {
        provider: "azure",
        code: "ResourceProviderNotConfigured",
        setting,
        message,
        suggestion,
        context: "lab provisioning",
      });
      return new Response(
        JSON.stringify({ error: message, setting, suggestion, correlation_id: correlationId, stage: "resource-provider" }),
        { status: 400, headers: traceHeaders },
      );
    }
    await trace.success(SOURCE, "resource-provider", `Using resource provider "${azure.displayName}"`, {
      account_id: azure.accountId,
      subscription_id: azure.subscriptionId,
      resource_group: azure.resourceGroup,
    });

    // Preflight: confirm the subscription exists and the service principal can
    // reach it before we create any DB row or Azure resource.
    await trace.start(SOURCE, "preflight", "Validating Azure subscription and service principal access");
    const preflight = await verifyAzureSubscription({
      tenantId: azure.tenantId,
      clientId: azure.clientId,
      clientSecret: azure.clientSecret,
      subscriptionId: azure.subscriptionId,
      resourceGroup: azure.resourceGroup,
      accountName: azure.displayName,
    });
    if (!preflight.ok) {
      console.error("provision-lab preflight failed:", JSON.stringify(preflight));
      await trace.failed(SOURCE, "preflight", preflight.message, {
        code: preflight.code,
        setting: preflight.setting,
        step: preflight.step,
      });
      if (preflight.setting) {
        await notifyConfigIssue(service, {
          provider: "azure",
          code: preflight.code ?? "PreflightFailed",
          setting: preflight.setting,
          message: preflight.message,
          suggestion: preflight.suggestion,
          context: "lab provisioning preflight",
        });
      }
      return new Response(
        JSON.stringify({
          correlation_id: correlationId,
          error: preflight.message,
          code: preflight.code,
          setting: preflight.setting,
          suggestion: preflight.suggestion,
          details: preflight.details,
          stage: `preflight:${preflight.step}`,
        }),
        { status: 400, headers: traceHeaders },
      );
    }
    await trace.success(SOURCE, "preflight", "Azure subscription and resource group reachable");

    // Determine region mapping
    const regionMap: Record<string, string> = {
      "East US": "eastus",
      "West US": "westus2",
      "Central India": "centralindia",
      "West Europe": "westeurope",
      "Southeast Asia": "southeastasia",
    };
    const azureRegion = regionMap[template.region] || azure.defaultRegion || "eastus";

    // Generate unique VM name
    const vmName = `lab-${template.id.substring(0, 8)}-${Date.now().toString(36)}`;

    // 1. Register VM in database as provisioning
    const { data: vmRecord, error: vmInsertError } = await supabase
      .from("virtual_machines")
      .insert({
        user_id: userId,
        lab_template_id: template.id,
        provider_account_id: azure.accountId,
        region: template.region === "All Regions" ? "East US" : template.region,
        vm_size: template.vm_size,
        status: "provisioning",
        expires_at: new Date(Date.now() + template.duration * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (vmInsertError) throw new Error(`Failed to register VM: ${vmInsertError.message}`);
    trace.attach({ vmId: vmRecord.id });
    await trace.success(SOURCE, "vm-record", "Lab VM registered and queued for provisioning", {
      vm_name: vmName,
      region: azureRegion,
      vm_size: template.vm_size,
    });

    // 2. Get Azure auth token
    await trace.start(SOURCE, "azure-auth", "Authenticating with Azure");
    const azureToken = await getAzureToken(azure.tenantId, azure.clientId, azure.clientSecret);
    await trace.success(SOURCE, "azure-auth", "Azure service principal authenticated");

    // 3. Create Azure VM
    let vmResult: { vmId: string; privateIp: string };
    await trace.start(SOURCE, "vm-create", `Creating Azure VM ${vmName}`);
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
      await trace.failed(
        SOURCE,
        "vm-create",
        azureError instanceof Error ? mapAzureError(azureError.message) : "Azure VM creation failed",
      );
      throw azureError;
    }
    await trace.success(SOURCE, "vm-create", "Azure VM created, waiting for it to boot", {
      azure_vm_id: vmResult.vmId,
      private_ip: vmResult.privateIp,
    });

    // 4. Update VM record with Azure details
    await supabase
      .from("virtual_machines")
      .update({
        azure_vm_id: vmResult.vmId,
        private_ip: vmResult.privateIp,
        status: "provisioning",
      })
      .eq("id", vmRecord.id);

    // 5. Return immediately — client will poll virtual_machines table for status
    // NOTE: Polling Azure for "running" is intentionally NOT done here.
    // The client polls the `check-vm-status` edge function (single source of truth),
    // which calls Azure on demand, updates the row, and recognizes running/failed/deallocated/stopped.
    // The `cleanup-idle-labs` cron also reconciles any VM stuck in 'provisioning' >10 minutes.

    const result = {
      vm_id: vmRecord.id,
      azure_vm_id: vmResult.vmId,
      private_ip: vmResult.privateIp,
      status: "provisioning",
      vm_name: vmName,
      correlation_id: correlationId,
    };

    await completeIdempotency(supabase, { key: idem.key, userId, action: "provision-lab", response: result });
    idem = null;

    return new Response(JSON.stringify(result), { status: 200, headers: traceHeaders });
  } catch (error: unknown) {
    console.error(`provision-lab error [${correlationId}]:`, error);
    const rawMessage = error instanceof Error ? error.message : "Unknown error";
    const userMessage = mapAzureError(rawMessage);
    const issue = detectConfigIssue(rawMessage, {
      subscriptionId: Deno.env.get("AZURE_SUBSCRIPTION_ID") ?? undefined,
      resourceGroup: Deno.env.get("AZURE_RESOURCE_GROUP") ?? undefined,
    });

    // A failed attempt must not block a genuine retry with the same key.
    if (admin && idem) {
      await releaseIdempotency(admin, { key: idem.key, userId: idem.userId, action: "provision-lab" });
    }

    if (timeline) await timeline.failed(SOURCE, "provisioning", userMessage, { azure_error: rawMessage, code: issue?.code });

    if (admin && issue?.setting) {
      await notifyConfigIssue(admin, {
        provider: "azure",
        code: issue.code ?? "ProvisioningConfigError",
        setting: issue.setting,
        message: userMessage,
        suggestion: issue.suggestion,
        context: "lab provisioning",
      });
    }

    return new Response(
      JSON.stringify({
        error: userMessage,
        azure_error: rawMessage,
        setting: issue?.setting,
        suggestion: issue?.suggestion,
        correlation_id: correlationId,
      }),
      { status: 400, headers: traceHeaders },
    );
  }
});
