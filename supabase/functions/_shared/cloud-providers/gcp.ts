// GCP provider adapter — placeholder (not implemented in v1).
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
  throw new Error("GCP provider is not yet implemented. Coming soon.");
}
export async function refreshSession(ctx: CreateCtx): Promise<Result> {
  return createSession(ctx);
}
export async function revokeSession(_ref: string | null): Promise<void> { return; }
