// AWS provider adapter — STS federation flow.
// Real implementation requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
// secrets plus a per-template RoleArn in template.provider_config.
// Until those are configured, this returns a deterministic stub URL and surfaces a
// clear error so the UI can show "not configured" rather than silently faking access.

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

export async function createSession(ctx: CreateCtx): Promise<Result> {
  const accessKey = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const roleArn = (ctx.templateConfig?.role_arn as string | undefined) || Deno.env.get("AWS_DEFAULT_ROLE_ARN");

  if (!accessKey || !secretKey) {
    throw new Error("AWS provider not configured: add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY secrets.");
  }
  if (!roleArn) {
    throw new Error("AWS provider not configured: set role_arn in the template's provider_config or AWS_DEFAULT_ROLE_ARN secret.");
  }

  // Implementation note: a full STS AssumeRole + getSigninToken flow requires
  // a SigV4 signer. Once secrets are present we will sign:
  //   1) POST sts.amazonaws.com AssumeRole with session-policy JSON
  //   2) GET signin.aws.amazon.com/federation?Action=getSigninToken&Session=...
  //   3) Build: https://signin.aws.amazon.com/federation?Action=login&Destination=...&SigninToken=...
  // For now we throw so calls land in the 'failed' state with a clear message
  // rather than handing the user a fake URL.
  throw new Error("AWS STS federation handler not yet wired in this build. Provider credentials are present — request the team to enable Phase 5b.");
}

export async function refreshSession(ctx: CreateCtx): Promise<Result> {
  return createSession(ctx);
}

export async function revokeSession(_ref: string | null): Promise<void> {
  // STS tokens expire on their own; nothing to revoke server-side.
  // For role-assumption-with-tags, optionally call iam:DeactivateMFADevice / equivalent.
  return;
}
