import { recordAudit } from "../_shared/admin-audit.ts";
import { corsHeadersFor } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapAzureError } from "../_shared/vm-state.ts";
import { verifyAzureSubscription, detectConfigIssue } from "../_shared/azure-preflight.ts";
import { notifyConfigIssue } from "../_shared/config-alerts.ts";
import { correlationHeaders, correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, findInFlightVm, idempotencyKeyFrom, releaseIdempotency } from "../_shared/idempotency.ts";
import {
  assertVmProvisioningReady, ensureAzureResourceGroup, ensureAzureSubnet, ProviderConfigError, resolveAzureRuntime,
  validateAzureCredentials,
  resolveVmAdminPassword, vmProvisioningGaps, type AzureRuntime,
} from "../_shared/cloud-providers/azure-runtime.ts";
import {
  assertAwsVmProvisioningReady, ensureAwsNetwork, resolveAwsRuntime, verifyAwsCredentials,
  createAwsVm, resolveLabAmiId, mapToAwsInstanceType, awsVmProvisioningGaps, type AwsRuntime,
} from "../_shared/cloud-providers/aws-runtime.ts";
import { loadAzureNetworkDefaults } from "../_shared/azure-network-settings.ts";
import { checkConnectivity } from "../_shared/connectivity-check.ts";
import { findResumableVm, RESUMABLE_VM_STATUSES, startCloudVm } from "../_shared/cloud-providers/vm-resume.ts";

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
    identity?: { type: "SystemAssigned" } | { type: "UserAssigned"; userAssignedIdentities: Record<string, unknown> };
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
  if (options.identity) vmPayload.identity = options.identity;

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
  const providerCtx: {
    subscriptionId?: string; resourceGroup?: string; accountName?: string;
    userId?: string; templateId?: string; templateName?: string;
  } = {};

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

    // Policy v1: any active manual_access_grants row unlocks published labs.
    // Cert-scoped matching (SKU / certification_slug) comes later.
    await trace.start(SOURCE, "manual-grant-check", "Verifying active Lab Grant for this user");
    const { data: activeGrants, error: grantError } = await supabase
      .from("manual_access_grants")
      .select("id")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(1);
    if (grantError) {
      console.error("provision-lab manual grant check failed:", grantError);
      await trace.failed(SOURCE, "manual-grant-check", grantError.message);
      return new Response(
        JSON.stringify({
          error: "Unable to verify lab access grant. Please try again or contact Ops.",
          code: "LAB_GRANT_CHECK_FAILED",
          correlation_id: correlationId,
          stage: "manual-grant-check",
        }),
        { status: 403, headers: traceHeaders },
      );
    }
    if (!activeGrants?.length) {
      const message =
        "Lab access denied: no active Lab Grant. After payment, Ops unlocks labs via Admin → Lab Grants.";
      await trace.failed(SOURCE, "manual-grant-check", message);
      return new Response(
        JSON.stringify({
          error: message,
          code: "NO_ACTIVE_LAB_GRANT",
          correlation_id: correlationId,
          stage: "manual-grant-check",
        }),
        { status: 403, headers: traceHeaders },
      );
    }
    await trace.success(
      SOURCE,
      "manual-grant-check",
      "Active lab grant present (policy v1: any active grant unlocks published labs)",
      { grant_id: activeGrants[0].id },
    );

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

    // --- Persistent lab REMINT --------------------------------------------
    // Disconnect ≠ deallocate. Inside the grant/template window a Start after a
    // Stop / Leave must hand back the SAME allocation: resume the existing VM
    // instead of creating (or destroying) anything. Only the soft-expiry job
    // (end_date EOD IST, or minutes exhausted) deallocates + notifies.
    if (template.is_persistent) {
      const existingVm = await findResumableVm(supabase, { userId, labTemplateId: lab_template_id });
      if (existingVm) {
        trace.attach({ vmId: existingVm.id });
        const needsStart = (RESUMABLE_VM_STATUSES as readonly string[]).includes(existingVm.status);
        let started = false;
        if (needsStart) {
          await trace.start(SOURCE, "remint", "Resuming your existing persistent lab VM (no new machine)");
          try {
            started = await startCloudVm(supabase, (template.provider || "azure") as string, existingVm);
          } catch (e) {
            console.error("persistent remint start failed", e);
          }
          if (started) {
            await supabase
              .from("virtual_machines")
              .update({ status: "starting", ended_at: null, ended_by: null, ended_reason: null })
              .eq("id", existingVm.id);
          }
          if (!started) {
            await trace.failed(SOURCE, "remint", "Could not power the existing lab VM back on");
            const failure = {
              error:
                "Your persistent lab machine could not be powered back on. It has NOT been deleted — please retry in a minute or contact support.",
              code: "REMINT_START_FAILED",
              vm_id: existingVm.id,
              correlation_id: correlationId,
              stage: "remint",
            };
            await completeIdempotency(supabase, { key: idemKey, userId, action: "provision-lab", response: failure });
            idem = null;
            return new Response(JSON.stringify(failure), { status: 503, headers: traceHeaders });
          }
        }
        const resumed = {
          vm_id: existingVm.id,
          azure_vm_id: existingVm.azure_vm_id,
          private_ip: existingVm.private_ip,
          status: needsStart ? "starting" : existingVm.status,
          reused_existing: true,
          reminted: needsStart,
          persistent: true,
          correlation_id: correlationId,
        };
        await trace.success(
          SOURCE,
          "remint",
          needsStart
            ? "Existing persistent lab VM is starting again — same allocation, nothing destroyed"
            : "Existing persistent lab VM is still allocated — reconnecting to it",
          { vm_id: existingVm.id, status: resumed.status },
        );
        await completeIdempotency(supabase, { key: idemKey, userId, action: "provision-lab", response: resumed });
        idem = null;
        return new Response(JSON.stringify(resumed), { status: 200, headers: traceHeaders });
      }
    }

    // --- Resource Provider ------------------------------------------------
    // Lab templates resolve to an active Azure or AWS account in the
    // Resource Providers registry. Without one we refuse to provision.
    const templateProvider = (template.provider || "azure") as string;
    if (templateProvider !== "azure" && templateProvider !== "aws") {
      return new Response(
        JSON.stringify({
          error: `Lab VM provisioning supports Azure and AWS resource providers (template is set to ${templateProvider}).`,
          setting: "Lab template → Resource provider",
          correlation_id: correlationId,
        }),
        { status: 400, headers: traceHeaders },
      );
    }

    await trace.start(SOURCE, "resource-provider", "Resolving resource provider account for this lab");
    const networkDefaults = await loadAzureNetworkDefaults(service);
    let azure: AzureRuntime | null = null;
    let aws: AwsRuntime | null = null;
    let resolvedRuntime: AzureRuntime | null = null;
    let subnetResolution: { subnetId: string; created: boolean; source: string } | null = null;

    if (templateProvider === "aws") {
      try {
        aws = await resolveAwsRuntime(supabase, template.provider_account_id);
        await trace.start(SOURCE, "subnet-resolve", "Resolving VPC/subnet/security group for this lab VM");
        const net = await ensureAwsNetwork(service, aws);
        subnetResolution = { subnetId: net.subnetId, created: net.created, source: net.source };
        await trace.success(
          SOURCE,
          "subnet-resolve",
          net.created ? "Created or discovered AWS lab network" : "Using configured AWS network",
          { subnet_id: net.subnetId, vpc_id: net.vpcId, security_group_id: net.securityGroupId, source: net.source },
        );
        assertAwsVmProvisioningReady(aws);
        providerCtx.accountName = aws.displayName;
        providerCtx.userId = userId;
        providerCtx.templateId = template.id;
        providerCtx.templateName = template.name;
        await trace.success(SOURCE, "resource-provider", `Using AWS resource provider "${aws.displayName}"`, {
          account_id: aws.accountId,
          region: aws.defaultRegion,
          subnet_id: aws.subnetId,
          vpc_id: aws.vpcId,
        });

        await trace.start(SOURCE, "preflight", "Validating AWS credentials via STS");
        const pre = await verifyAwsCredentials(aws);
        if (!pre.ok) {
          await trace.failed(SOURCE, "preflight", pre.message);
          return new Response(
            JSON.stringify({
              correlation_id: correlationId,
              error: pre.message,
              setting: `Resource Providers → ${aws.displayName}`,
              suggestion: "Update Access Key / Secret on the AWS resource provider and re-test connection.",
              stage: "preflight:sts",
            }),
            { status: 400, headers: traceHeaders },
          );
        }
        await trace.success(SOURCE, "preflight", pre.message, { account: pre.account, arn: pre.arn });

        const awsRegion = aws.defaultRegion;
        const instanceType = mapToAwsInstanceType(template.vm_size);
        const vmName = `lab-${template.id.substring(0, 8)}-${Date.now().toString(36)}`;

        const { data: vmRecord, error: vmInsertError } = await supabase
          .from("virtual_machines")
          .insert({
            user_id: userId,
            lab_template_id: template.id,
            provider_account_id: aws.accountId,
            region: awsRegion,
            vm_size: instanceType,
            status: "provisioning",
            expires_at: template.is_persistent ? null : new Date(Date.now() + template.duration * 60 * 1000).toISOString(),
          })
          .select()
          .single();
        if (vmInsertError) throw new Error(`Failed to register VM: ${vmInsertError.message}`);
        trace.attach({ vmId: vmRecord.id });
        await trace.success(SOURCE, "vm-record", "Lab VM registered and queued for provisioning", {
          vm_name: vmName, region: awsRegion, instance_type: instanceType,
        });

        await trace.start(SOURCE, "ami-resolve", "Resolving lab AMI");
        const amiId = await resolveLabAmiId(aws, template.os_image);
        await trace.success(SOURCE, "ami-resolve", `Using AMI ${amiId}`);

        let vmResult: { instanceId: string; privateIp: string };
        await trace.start(SOURCE, "vm-create", `Creating EC2 instance ${vmName} (${instanceType})`);
        try {
          vmResult = await createAwsVm(aws, {
            name: vmName,
            instanceType,
            amiId,
            osImage: template.os_image,
          });
        } catch (awsError) {
          await supabase.from("virtual_machines").update({ status: "failed" }).eq("id", vmRecord.id);
          await trace.failed(SOURCE, "vm-create", awsError instanceof Error ? awsError.message : "EC2 RunInstances failed");
          throw awsError;
        }
        await trace.success(SOURCE, "vm-create", "EC2 instance launched", {
          instance_id: vmResult.instanceId, private_ip: vmResult.privateIp, subnet_id: aws.subnetId,
        });

        if (networkDefaults.connectivityCheckEnabled) {
          await trace.start(SOURCE, "connectivity-check", "Checking remote access port reachability");
          const probe = await checkConnectivity(
            vmResult.privateIp,
            template.os_image,
            networkDefaults.connectivityCheckTimeoutMs,
          );
          const label = `${probe.protocol.toUpperCase()} ${probe.host ?? "-"}:${probe.port}`;
          if (!probe.attempted) await trace.skipped(SOURCE, "connectivity-check", `Skipped — ${probe.error}`, probe);
          else if (probe.reachable) await trace.success(SOURCE, "connectivity-check", `${label} reachable in ${probe.latency_ms}ms`, probe);
          else await trace.failed(SOURCE, "connectivity-check", `${label} not reachable yet (${probe.error}). The VM may still be booting.`, probe);
        } else {
          await trace.skipped(SOURCE, "connectivity-check", "Connectivity check disabled in platform settings");
        }

        // Store EC2 instance id in azure_vm_id (legacy column = cloud instance ref).
        await supabase.from("virtual_machines").update({
          azure_vm_id: vmResult.instanceId,
          private_ip: vmResult.privateIp,
          status: "provisioning",
        }).eq("id", vmRecord.id);

        const result = {
          vm_id: vmRecord.id,
          azure_vm_id: vmResult.instanceId,
          instance_id: vmResult.instanceId,
          provider: "aws",
          private_ip: vmResult.privateIp,
          status: "provisioning",
          vm_name: vmName,
          subnet_id: aws.subnetId,
          subnet_source: subnetResolution?.source ?? "configured",
          correlation_id: correlationId,
        };
        await completeIdempotency(supabase, { key: idem.key, userId, action: "provision-lab", response: result });
        idem = null;
        await recordAudit(supabase, {
          actorId: userId, action: "lab.launch", entityType: "lab_template",
          entityId: template.id, entityLabel: template.name, outcome: "success",
          correlationId,
          changes: { vm_id: vmRecord.id, region: awsRegion, provider_account: aws.displayName, subnet_id: aws.subnetId, provider: "aws" },
          message: `Launched AWS lab VM ${vmName}`,
        });
        return new Response(JSON.stringify(result), { status: 200, headers: traceHeaders });
      } catch (e) {
        if (e instanceof ProviderConfigError || (aws && e instanceof Error)) {
          const message = e instanceof Error ? e.message : "Resource provider not configured";
          const setting = e instanceof ProviderConfigError ? e.setting : `Resource Providers → ${aws?.displayName ?? "AWS"}`;
          const suggestion = e instanceof ProviderConfigError ? e.suggestion : undefined;
          const missingFields = aws ? awsVmProvisioningGaps(aws).map((g) => g.field) : [];
          // Only treat config errors as soft 400; rethrow unexpected after notify
          if (e instanceof ProviderConfigError) {
            await trace.failed(SOURCE, "resource-provider", message, { setting });
            await notifyConfigIssue(service, {
              provider: "aws",
              code: "ResourceProviderNotConfigured",
              setting,
              message,
              suggestion,
              context: "lab provisioning",
            });
            return new Response(
              JSON.stringify({
                error: message, setting, suggestion, missing_fields: missingFields,
                correlation_id: correlationId, stage: "resource-provider",
              }),
              { status: 400, headers: traceHeaders },
            );
          }
        }
        throw e;
      }
    }

    try {
      azure = await resolveAzureRuntime(supabase, template.provider_account_id);
      resolvedRuntime = azure;

      // Make sure the resource group exists before anything else touches ARM.
      const rgRegion = azure.defaultRegion || "eastus";
      await trace.start(SOURCE, "resource-group", "Verifying the Azure resource group");
      const rgResult = await ensureAzureResourceGroup(service, azure, rgRegion, networkDefaults);
      await trace.success(
        SOURCE,
        "resource-group",
        rgResult.created
          ? `Created resource group "${rgResult.resourceGroup}" in ${rgRegion}`
          : `Resource group "${rgResult.resourceGroup}" exists`,
        { resource_group: rgResult.resourceGroup, created: rgResult.created },
      );

      if (azure.subnetId) {

        subnetResolution = { subnetId: azure.subnetId, created: false, source: "configured" };
      } else {
        // No subnet configured: reuse an existing VNet or create a lab VNet
        // (using the admin network defaults), then persist the id back.
        const regionHint = azure.defaultRegion || "eastus";
        await trace.start(SOURCE, "subnet-resolve", "Resolving a network subnet for this lab VM");
        subnetResolution = await ensureAzureSubnet(service, azure, regionHint, networkDefaults);
        await trace.success(
          SOURCE,
          "subnet-resolve",
          subnetResolution.created
            ? `Created lab network ${networkDefaults.vnetName} (${networkDefaults.vnetCidr})`
            : "Reused an existing virtual network subnet",
          { subnet_id: subnetResolution.subnetId, source: subnetResolution.source,
            vnet_cidr: networkDefaults.vnetCidr, subnet_cidr: networkDefaults.subnetCidr },
        );
      }
      assertVmProvisioningReady(azure);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Resource provider not configured";
      const setting = e instanceof ProviderConfigError ? e.setting : "Resource Providers";
      const suggestion = e instanceof ProviderConfigError ? e.suggestion : undefined;
      const missingFields = resolvedRuntime ? vmProvisioningGaps(resolvedRuntime).map((g) => g.field) : [];
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
        JSON.stringify({
          error: message, setting, suggestion, missing_fields: missingFields,
          correlation_id: correlationId, stage: "resource-provider",
        }),
        { status: 400, headers: traceHeaders },
      );
    }
    if (!azure) throw new Error("Azure runtime missing after resource-provider resolution");
    providerCtx.subscriptionId = azure.subscriptionId;
    providerCtx.resourceGroup = azure.resourceGroup;
    providerCtx.accountName = azure.displayName;
    providerCtx.userId = userId;
    providerCtx.templateId = template.id;
    providerCtx.templateName = template.name;
    await trace.success(SOURCE, "resource-provider", `Using resource provider "${azure.displayName}"`, {
      account_id: azure.accountId,
      subscription_id: azure.subscriptionId,
      resource_group: azure.resourceGroup,
      subnet_id: azure.subnetId,
      subnet_source: subnetResolution?.source ?? "configured",
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

    // Credential freshness: an expired Key Vault secret or a deleted managed
    // identity must fail here with an actionable message, not mid-deployment.
    await trace.start(SOURCE, "credential-check", "Validating VM credentials");
    const credentials = await validateAzureCredentials(azure);
    if (!credentials.ok) {
      const blocking = credentials.issues.filter((i) => i.severity === "error");
      const message = `Resource provider "${azure.displayName}" has outdated credentials: ${
        blocking.map((i) => i.message).join(" ")
      }`;
      await trace.failed(SOURCE, "credential-check", message, { issues: credentials.issues });
      await recordAudit(service, {
        actorId: userId, action: "lab.launch", entityType: "lab_template",
        entityId: template.id, entityLabel: template.name, outcome: "blocked",
        correlationId, message, changes: { issues: blocking, auth_mode: credentials.authMode },
      });
      return new Response(
        JSON.stringify({
          error: message,
          setting: `Resource Providers → ${azure.displayName}`,
          suggestion: "Open Admin → Resource Providers, run \"Validate credentials\" and rotate the secret.",
          missing_fields: blocking.map((i) => i.field),
          issues: credentials.issues,
          correlation_id: correlationId,
          stage: "credential-check",
        }),
        { status: 400, headers: traceHeaders },
      );
    }
    await trace.success(
      SOURCE,
      "credential-check",
      credentials.issues.length
        ? `Credentials usable — ${credentials.issues.map((i) => i.message).join(" ")}`
        : `Credentials valid (${credentials.authMode})`,
      credentials.details,
    );

    // Determine region mapping
    const regionMap: Record<string, string> = {
      "East US": "eastus",
      "West US": "westus2",
      "Central US": "centralus",
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
        // Persist actual Azure location (not template display label like "East US")
        region: azureRegion,
        vm_size: template.vm_size,
        status: "provisioning",
        expires_at: template.is_persistent ? null : new Date(Date.now() + template.duration * 60 * 1000).toISOString(),
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
    // Admin credential: stored password, Key Vault secret, or an ephemeral
    // password when the account uses managed identity for VM access.
    const vmAdminPassword = await resolveVmAdminPassword(azure);
    await trace.success(SOURCE, "azure-auth", "Azure service principal authenticated");

    // 3. Create Azure VM
    let vmResult: { vmId: string; privateIp: string };
    await trace.start(SOURCE, "vm-create", `Creating Azure VM ${vmName}`);
    try {
      vmResult = await createAzureVM(azureToken, azure.subscriptionId, azure.resourceGroup, vmName, {
        region: azureRegion,
        vmSize: template.vm_size,
        osImage: template.os_image,
        adminUsername: azure.adminUsername,
        adminPassword: vmAdminPassword,
        subnetId: azure.subnetId,
        identity: azure.authMode === "managed_identity"
          ? (azure.managedIdentityId
            ? { type: "UserAssigned" as const, userAssignedIdentities: { [azure.managedIdentityId]: {} } }
            : { type: "SystemAssigned" as const })
          : undefined,
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
      subnet_id: azure.subnetId,
    });

    // 3b. Optional post-provisioning connectivity probe (SSH/RDP).
    if (networkDefaults.connectivityCheckEnabled) {
      await trace.start(SOURCE, "connectivity-check", "Checking remote access port reachability");
      const probe = await checkConnectivity(
        vmResult.privateIp,
        template.os_image,
        networkDefaults.connectivityCheckTimeoutMs,
      );
      const label = `${probe.protocol.toUpperCase()} ${probe.host ?? "-"}:${probe.port}`;
      if (!probe.attempted) {
        await trace.skipped(SOURCE, "connectivity-check", `Skipped — ${probe.error}`, probe);
      } else if (probe.reachable) {
        await trace.success(SOURCE, "connectivity-check", `${label} reachable in ${probe.latency_ms}ms`, probe);
      } else {
        await trace.failed(
          SOURCE,
          "connectivity-check",
          `${label} not reachable yet (${probe.error}). The VM may still be booting.`,
          probe,
        );
      }
    } else {
      await trace.skipped(SOURCE, "connectivity-check", "Connectivity check disabled in platform settings");
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
      subnet_id: azure.subnetId,
      subnet_source: subnetResolution?.source ?? "configured",
      correlation_id: correlationId,
    };

    await completeIdempotency(supabase, { key: idem.key, userId, action: "provision-lab", response: result });
    idem = null;

    await recordAudit(supabase, {
      actorId: userId, action: "lab.launch", entityType: "lab_template",
      entityId: template.id, entityLabel: template.name, outcome: "success",
      correlationId,
      changes: { vm_id: vmRecord.id, region: azureRegion, provider_account: azure.displayName, subnet_id: azure.subnetId },
      message: `Launched lab VM ${vmName}`,
    });

    return new Response(JSON.stringify(result), { status: 200, headers: traceHeaders });
  } catch (error: unknown) {
    console.error(`provision-lab error [${correlationId}]:`, error);
    const rawMessage = error instanceof Error ? error.message : "Unknown error";
    const userMessage = mapAzureError(rawMessage);
    const issue = detectConfigIssue(rawMessage, {
      subscriptionId: providerCtx.subscriptionId,
      resourceGroup: providerCtx.resourceGroup,
      accountName: providerCtx.accountName,
    });

    // A failed attempt must not block a genuine retry with the same key.
    if (admin && idem) {
      await releaseIdempotency(admin, { key: idem.key, userId: idem.userId, action: "provision-lab" });
    }

    if (admin) {
      await recordAudit(admin, {
        actorId: providerCtx.userId ?? null, action: "lab.launch", entityType: "lab_template",
        entityId: providerCtx.templateId ?? null, entityLabel: providerCtx.templateName ?? null,
        outcome: "failed", correlationId, message: userMessage,
        changes: { azure_error: rawMessage.slice(0, 500), code: issue?.code ?? null },
      });
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
