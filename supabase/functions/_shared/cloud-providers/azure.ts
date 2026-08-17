// Azure provider adapter — time-boxed RBAC role assignment, returns Azure portal deep link.
// Credentials come from the linked Resource Provider account (never from env).
// Per-template provider_config (merged with the Resource Provider account config):
//   { subscription_id, resource_group?, scope?, role_definition_id, use_pim? }
// User profile MUST have azure_object_id (Entra ID oid).

interface CreateCtx {
  userId: string;
  templateConfig: Record<string, unknown>;
  region: string | null;
  durationMinutes: number;
  // Resolved by the caller (cloud-access-session) from profile + resource provider account:
  azureObjectId?: string | null;
  azureDefaults?: Record<string, unknown> | null;
  /** Credentials from the selected resource provider account. */
  credentials?: Record<string, string> | null;
  accountConfig?: Record<string, unknown> | null;
}

export interface AzureCreds { tenant_id?: string; client_id?: string; client_secret?: string }

interface Result {
  federated_url: string;
  provider_session_ref: string | null;
  scope: Record<string, unknown>;
}

async function armToken(creds?: AzureCreds | null): Promise<string> {
  const tenant = creds?.tenant_id;
  const clientId = creds?.client_id;
  const secret = creds?.client_secret;
  if (!tenant || !clientId || !secret) {
    throw new Error("Azure resource provider not configured: add an Azure account under Admin → Resource Providers.");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: secret,
    resource: "https://management.azure.com/",
  });
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`AAD token failed (${resp.status}): ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  return json.access_token as string;
}

function guid(): string {
  return crypto.randomUUID();
}

function resolveScope(cfg: Record<string, unknown>, defaults: Record<string, unknown> | null): string {
  const explicit = (cfg.scope as string | undefined) || (defaults?.scope as string | undefined);
  if (explicit) return explicit;
  const sub = (cfg.subscription_id as string | undefined) || (defaults?.subscription_id as string | undefined);
  const rg  = (cfg.resource_group as string | undefined) || (defaults?.resource_group as string | undefined);
  if (!sub) throw new Error("Azure provider not configured: set a subscription_id on the template provider config or on the Azure account under Admin → Resource Providers.");
  if (rg) return `/subscriptions/${sub}/resourceGroups/${rg}`;
  return `/subscriptions/${sub}`;
}

function resolveRoleDefinitionId(cfg: Record<string, unknown>, defaults: Record<string, unknown> | null, scope: string): string {
  const raw = (cfg.role_definition_id as string | undefined)
    || (defaults?.role_definition_id as string | undefined)
    || "acdd72a7-3385-48ef-bd42-f606fba81ae7"; // Reader (built-in)
  if (raw.startsWith("/")) return raw;
  // Scope-qualified built-in role
  return `${scope.split("/resourceGroups/")[0]}/providers/Microsoft.Authorization/roleDefinitions/${raw}`;
}

export async function createSession(ctx: CreateCtx): Promise<Result> {
  if (!ctx.azureObjectId) {
    throw new Error("This user is missing azure_object_id on their profile. An admin must set it before granting Azure access.");
  }
  const cfg = ctx.templateConfig || {};
  const defaults = { ...(ctx.azureDefaults || {}), ...(ctx.accountConfig || {}) } as Record<string, unknown>;
  const scope = resolveScope(cfg, defaults);
  const roleDefinitionId = resolveRoleDefinitionId(cfg, defaults, scope);
  const usePim = Boolean(cfg.use_pim ?? defaults?.use_pim);
  const tenantId = (cfg.tenant_id as string | undefined)
    || ctx.credentials?.tenant_id
    || (defaults?.tenant_id as string | undefined)!;

  const token = await armToken(ctx.credentials as AzureCreds | null | undefined);
  const assignmentName = guid();
  const startDateTime = new Date(Date.now() + 60_000).toISOString();        // start ~1 min from now
  const endDateTime   = new Date(Date.now() + ctx.durationMinutes * 60_000).toISOString();

  let assignmentPath: string;
  let body: Record<string, unknown>;

  if (usePim) {
    // PIM-style time-boxed assignment (requires PIM SKU on the tenant).
    assignmentPath = `${scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${assignmentName}?api-version=2020-10-01`;
    body = {
      properties: {
        principalId: ctx.azureObjectId,
        roleDefinitionId,
        requestType: "AdminAssign",
        scheduleInfo: {
          startDateTime,
          expiration: { type: "AfterDateTime", endDateTime },
        },
        justification: "Lovable Cloud Lab session",
      },
    };
  } else {
    // Standard role assignment — revoked explicitly on session end / cleanup cron.
    assignmentPath = `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentName}?api-version=2022-04-01`;
    body = {
      properties: {
        roleDefinitionId,
        principalId: ctx.azureObjectId,
        principalType: "User",
        description: `Lovable Cloud Lab session (expires ${endDateTime})`,
      },
    };
  }

  const resp = await fetch(`https://management.azure.com${assignmentPath}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Azure role assignment failed (${resp.status}): ${text.slice(0, 500)}`);
  const json = JSON.parse(text);

  const assignmentId: string = json?.id || assignmentPath.split("?")[0];

  const portal = `https://portal.azure.com/#@${tenantId}/resource${scope}/overview`;

  return {
    federated_url: portal,
    provider_session_ref: assignmentId,
    scope: {
      scope,
      role_definition_id: roleDefinitionId,
      principal_id: ctx.azureObjectId,
      end_date_time: endDateTime,
      use_pim: usePim,
    },
  };
}

export async function refreshSession(ctx: CreateCtx): Promise<Result> {
  // Extend by revoking the prior assignment (caller passes new ctx) and creating a fresh one.
  return createSession(ctx);
}

export async function revokeSession(ref: string | null, creds?: AzureCreds | null): Promise<void> {
  if (!ref) return;
  try {
    const token = await armToken(creds);
    // ref is the full ARM id; DELETE works for both classic and PIM schedule-request ids.
    const apiVersion = ref.includes("roleAssignmentScheduleRequests")
      ? "2020-10-01" : "2022-04-01";
    await fetch(`https://management.azure.com${ref}?api-version=${apiVersion}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.warn("azure revoke failed:", e);
  }
}
