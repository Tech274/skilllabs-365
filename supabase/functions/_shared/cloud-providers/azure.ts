// Azure provider adapter — time-boxed RBAC role assignment on a scoped RG/subscription.
// Requires AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_SUBSCRIPTION_ID
// secrets (already configured for the VM-lab side of this project) plus the user's
// Entra ID object id (oid) stored on the profile as azure_object_id.

interface CreateCtx {
  userId: string;
  templateConfig: Record<string, unknown>;
  region: string | null;
  durationMinutes: number;
}

interface Result {
  federated_url: string;
  provider_session_ref: string | null;
  scope: Record<string, unknown>;
}

export async function createSession(_ctx: CreateCtx): Promise<Result> {
  const haveTenant = Deno.env.get("AZURE_TENANT_ID");
  if (!haveTenant) {
    throw new Error("Azure provider not configured: AZURE_TENANT_ID is missing.");
  }
  // Implementation note: real flow is
  //   1) Lookup profile.azure_object_id for the user
  //   2) Microsoft.Authorization/roleAssignments PUT with endDateTime = now + duration
  //   3) Return https://portal.azure.com/#@<tenant>/resource/<scope>/overview
  //   provider_session_ref = the roleAssignmentId so revoke can DELETE it.
  throw new Error("Azure portal federation handler not yet wired in this build. Configure the user's azure_object_id and request Phase 5b.");
}

export async function refreshSession(ctx: CreateCtx): Promise<Result> {
  return createSession(ctx);
}

export async function revokeSession(_ref: string | null): Promise<void> {
  // Real impl: DELETE the role assignment by id (ref).
  return;
}
