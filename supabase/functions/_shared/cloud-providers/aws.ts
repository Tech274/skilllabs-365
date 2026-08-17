// AWS provider adapter — STS AssumeRole + getSigninToken federation.
// Required secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
// Optional: AWS_SESSION_TOKEN (for assumed-role base creds).
// Per-template provider_config:  { role_arn, region?, session_policy?, external_id? }

interface CreateCtx {
  userId: string;
  templateConfig: Record<string, unknown>;
  region: string | null;
  durationMinutes: number;
  /** Credentials from the selected resource provider account (preferred over env). */
  credentials?: Record<string, string> | null;
  /** Non-secret config from the selected resource provider account. */
  accountConfig?: Record<string, unknown> | null;
}

interface Result {
  federated_url: string;
  provider_session_ref: string | null;
  scope: Record<string, unknown>;
}

const enc = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data) as BufferSource);
  return new Uint8Array(sig);
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<Uint8Array> {
  const kDate    = await hmac(enc.encode("AWS4" + secret), date);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, "aws4_request");
}

function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

interface StsCreds {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: string;
}

/** SigV4-signed POST to sts.amazonaws.com AssumeRole. Returns temporary credentials. */
async function assumeRole(opts: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  roleArn: string;
  roleSessionName: string;
  durationSeconds: number;
  policy?: string | null;
  externalId?: string | null;
}): Promise<StsCreds> {
  const region = "us-east-1";
  const service = "sts";
  const host = "sts.amazonaws.com";
  const method = "POST";

  const params = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: opts.roleArn,
    RoleSessionName: opts.roleSessionName.slice(0, 64),
    DurationSeconds: String(Math.min(Math.max(opts.durationSeconds, 900), 43200)),
  });
  if (opts.policy) params.set("Policy", opts.policy);
  if (opts.externalId) params.set("ExternalId", opts.externalId);
  const body = params.toString();
  const bodyHash = await sha256Hex(body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    host,
    "x-amz-date": amzDate,
  };
  if (opts.sessionToken) headers["x-amz-security-token"] = opts.sessionToken;

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonical = [method, "/", "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonical)].join("\n");
  const kSigning = await signingKey(opts.secretAccessKey, dateStamp, region, service);
  const sig = [...await hmac(kSigning, stringToSign)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const resp = await fetch(`https://${host}/`, {
    method,
    headers: { ...headers, authorization, accept: "application/json" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`STS AssumeRole failed (${resp.status}): ${text.slice(0, 400)}`);
  // STS returns JSON when Accept: application/json
  const json = JSON.parse(text);
  const creds = json?.AssumeRoleResponse?.AssumeRoleResult?.Credentials
    ?? json?.Credentials;
  if (!creds?.AccessKeyId) throw new Error("STS response missing credentials");
  return creds as StsCreds;
}

/** GET signin.aws.amazon.com/federation?Action=getSigninToken → { SigninToken } */
async function getSigninToken(creds: StsCreds, sessionDurationSec: number): Promise<string> {
  const session = JSON.stringify({
    sessionId: creds.AccessKeyId,
    sessionKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  });
  const url = `https://signin.aws.amazon.com/federation?Action=getSigninToken`
    + `&SessionDuration=${Math.min(Math.max(sessionDurationSec, 900), 43200)}`
    + `&Session=${rfc3986(session)}`;
  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`getSigninToken failed (${resp.status}): ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  if (!json?.SigninToken) throw new Error("getSigninToken response missing SigninToken");
  return json.SigninToken as string;
}

function consoleDestination(region: string | null): string {
  const r = region || "us-east-1";
  return `https://${r}.console.aws.amazon.com/console/home?region=${r}`;
}

/** Signed sts:GetCallerIdentity — used by the admin "Test connection" action. */
export async function stsGetCallerIdentity(creds: {
  accessKeyId: string; secretAccessKey: string; sessionToken?: string | null;
}): Promise<{ Account?: string; Arn?: string; UserId?: string }> {
  const region = "us-east-1", service = "sts", host = "sts.amazonaws.com";
  const body = new URLSearchParams({ Action: "GetCallerIdentity", Version: "2011-06-15" }).toString();
  const bodyHash = await sha256Hex(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8", host, "x-amz-date": amzDate,
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
  const keys = Object.keys(headers).sort();
  const canonicalHeaders = keys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = keys.join(";");
  const canonical = ["POST", "/", "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonical)].join("\n");
  const kSigning = await signingKey(creds.secretAccessKey, dateStamp, region, service);
  const sig = [...await hmac(kSigning, stringToSign)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  const resp = await fetch(`https://${host}/`, {
    method: "POST", headers: { ...headers, authorization, accept: "application/json" }, body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`STS GetCallerIdentity failed (${resp.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return json?.GetCallerIdentityResponse?.GetCallerIdentityResult ?? json ?? {};
}

export async function createSession(ctx: CreateCtx): Promise<Result> {
  const creds0 = ctx.credentials || {};
  const acct = ctx.accountConfig || {};
  const accessKey = creds0.access_key_id || Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretKey = creds0.secret_access_key || Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const sessionTok = creds0.session_token || Deno.env.get("AWS_SESSION_TOKEN") || null;
  const cfg = ctx.templateConfig || {};
  const roleArn = (cfg.role_arn as string | undefined)
    || (acct.default_role_arn as string | undefined)
    || Deno.env.get("AWS_DEFAULT_ROLE_ARN");
  const policy  = (cfg.session_policy as string | undefined) || null;
  const externalId = (cfg.external_id as string | undefined) || (acct.external_id as string | undefined) || null;

  if (!accessKey || !secretKey) {
    throw new Error("AWS resource provider not configured: add an AWS account under Admin → Resource Providers.");
  }
  if (!roleArn) {
    throw new Error("AWS not configured: set role_arn in the template's provider config or a default role ARN on the resource provider account.");
  }

  const durationSeconds = ctx.durationMinutes * 60;
  const creds = await assumeRole({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    sessionToken: sessionTok,
    roleArn,
    roleSessionName: `lovable-${ctx.userId.slice(0, 8)}-${Date.now().toString(36)}`,
    durationSeconds,
    policy,
    externalId,
  });

  const destination = consoleDestination(ctx.region);
  const signinToken = await getSigninToken(creds, durationSeconds);
  const federated_url = `https://signin.aws.amazon.com/federation`
    + `?Action=login`
    + `&Issuer=${rfc3986("lovable-cloud-lab")}`
    + `&Destination=${rfc3986(destination)}`
    + `&SigninToken=${rfc3986(signinToken)}`;

  return {
    federated_url,
    provider_session_ref: creds.AccessKeyId,
    scope: {
      role_arn: roleArn,
      destination,
      expires_at: creds.Expiration,
    },
  };
}

export async function refreshSession(ctx: CreateCtx): Promise<Result> {
  return createSession(ctx);
}

export async function revokeSession(_ref: string | null): Promise<void> {
  // STS temporary credentials cannot be revoked client-side; they expire.
  // For role-level kill-switch, an admin would call iam:PutRolePolicy with a deny-all
  // condition or rotate the trust policy. Out of scope for per-session revoke.
  return;
}
