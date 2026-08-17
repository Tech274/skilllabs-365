// Azure configuration preflight helpers.
//
// Used by `provision-lab` before creating any resource, and by
// `cloud-provider-config` (action: test-azure-subscription) so admins can probe
// the configuration from the Cloud Providers screen.

export type AzureProbeResult = {
  ok: boolean;
  step: "token" | "subscription" | "resource_group" | "done";
  code?: string;
  message: string;
  /** Which Cloud Providers setting should be updated when this fails. */
  setting?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
};

export async function getAzureToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Azure auth failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

/** Maps a raw Azure error string to the Cloud Providers setting that needs fixing. */
export function detectConfigIssue(
  raw: string,
  ctx: { subscriptionId?: string; resourceGroup?: string } = {},
): { code: string; setting: string; suggestion: string } | null {
  const m = raw || "";
  if (/SubscriptionNotFound|could not be found|InvalidSubscriptionId/i.test(m)) {
    return {
      code: "SubscriptionNotFound",
      setting: "AZURE_SUBSCRIPTION_ID",
      suggestion:
        `Azure does not recognise subscription "${ctx.subscriptionId ?? "(unset)"}" for this service principal. ` +
        `Update AZURE_SUBSCRIPTION_ID on Cloud Providers, or grant the service principal Contributor on that subscription.`,
    };
  }
  if (/DisabledSubscription|SubscriptionDisabled/i.test(m)) {
    return {
      code: "DisabledSubscription",
      setting: "AZURE_SUBSCRIPTION_ID",
      suggestion: "The Azure subscription is disabled. Re-enable it in Azure or point AZURE_SUBSCRIPTION_ID at an active subscription.",
    };
  }
  if (/AuthorizationFailed|does not have authorization/i.test(m)) {
    return {
      code: "AuthorizationFailed",
      setting: "AZURE_CLIENT_ID / role assignment",
      suggestion: "The service principal lacks permission. Assign it the Contributor role on the subscription or resource group.",
    };
  }
  if (/ResourceGroupNotFound/i.test(m)) {
    return {
      code: "ResourceGroupNotFound",
      setting: "AZURE_RESOURCE_GROUP",
      suggestion: `Resource group "${ctx.resourceGroup ?? "(unset)"}" does not exist in this subscription. Create it or update AZURE_RESOURCE_GROUP.`,
    };
  }
  if (/AADSTS|invalid_client|unauthorized_client|Azure auth failed/i.test(m)) {
    return {
      code: "InvalidClientSecret",
      setting: "AZURE_CLIENT_SECRET",
      suggestion: "Service principal sign-in failed. Re-enter AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (use the secret *value*, not the secret ID) and AZURE_TENANT_ID.",
    };
  }
  if (/MissingSubscriptionRegistration/i.test(m)) {
    return {
      code: "MissingSubscriptionRegistration",
      setting: "Azure resource providers",
      suggestion: "Register the Microsoft.Compute and Microsoft.Network resource providers on the subscription.",
    };
  }
  return null;
}

/**
 * Verifies the subscription exists and the configured service principal can
 * read it (and optionally the resource group) before any provisioning attempt.
 */
export async function verifyAzureSubscription(opts: {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  token?: string;
}): Promise<AzureProbeResult> {
  const { subscriptionId, resourceGroup } = opts;

  if (!subscriptionId) {
    return {
      ok: false, step: "subscription", code: "MissingConfig",
      message: "AZURE_SUBSCRIPTION_ID is not configured.",
      setting: "AZURE_SUBSCRIPTION_ID",
      suggestion: "Set AZURE_SUBSCRIPTION_ID on Cloud Providers.",
    };
  }

  let token = opts.token;
  if (!token) {
    try {
      token = await getAzureToken(opts.tenantId!, opts.clientId!, opts.clientSecret!);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const issue = detectConfigIssue(raw, { subscriptionId, resourceGroup });
      return {
        ok: false, step: "token", code: "AuthFailed", message: raw,
        setting: issue?.setting ?? "AZURE_CLIENT_SECRET",
        suggestion: issue?.suggestion,
      };
    }
  }

  const subRes = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2022-12-01`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const subText = await subRes.text();
  if (!subRes.ok) {
    let code = String(subRes.status);
    try { code = JSON.parse(subText)?.error?.code ?? code; } catch { /* not json */ }
    const issue = detectConfigIssue(`${code} ${subText}`, { subscriptionId, resourceGroup });
    return {
      ok: false, step: "subscription", code,
      message: `Azure rejected subscription ${subscriptionId}: ${code} — ${subText.slice(0, 500)}`,
      setting: issue?.setting ?? "AZURE_SUBSCRIPTION_ID",
      suggestion: issue?.suggestion ??
        "Verify AZURE_SUBSCRIPTION_ID and that the service principal has access to that subscription.",
      details: { subscription_id: subscriptionId, http_status: subRes.status },
    };
  }

  let subState: unknown = null;
  let displayName: unknown = null;
  try {
    const parsed = JSON.parse(subText);
    subState = parsed.state;
    displayName = parsed.displayName;
  } catch { /* ignore */ }

  if (resourceGroup) {
    const rgRes = await fetch(
      `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups/${resourceGroup}?api-version=2021-04-01`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!rgRes.ok) {
      const rgText = await rgRes.text();
      let code = String(rgRes.status);
      try { code = JSON.parse(rgText)?.error?.code ?? code; } catch { /* not json */ }
      const issue = detectConfigIssue(`${code} ${rgText}`, { subscriptionId, resourceGroup });
      return {
        ok: false, step: "resource_group", code,
        message: `Resource group "${resourceGroup}" check failed: ${code} — ${rgText.slice(0, 300)}`,
        setting: issue?.setting ?? "AZURE_RESOURCE_GROUP",
        suggestion: issue?.suggestion ?? "Create the resource group or update AZURE_RESOURCE_GROUP.",
        details: { subscription_id: subscriptionId, resource_group: resourceGroup },
      };
    }
  }

  return {
    ok: true, step: "done",
    message: `Subscription reachable${displayName ? ` (${displayName})` : ""}${subState ? ` — state ${subState}` : ""}.`,
    details: { subscription_id: subscriptionId, resource_group: resourceGroup ?? null, state: subState, display_name: displayName },
  };
}
