/**
 * Edge functions return non-2xx for failures, which supabase-js surfaces as a
 * FunctionsHttpError with the JSON body hidden in `context`. This unwraps the
 * body so the UI can show the exact backend error plus the remediation hint
 * (e.g. Azure SubscriptionNotFound -> which Cloud Providers setting to fix).
 */
export interface EdgeFunctionErrorBody {
  error?: string;
  azure_error?: string;
  code?: string;
  /** Cloud/AWS reject detail from cleanup-idle-labs start-vm (502). */
  detail?: string;
  aws_state?: string | null;
  provider?: string;
  region?: string | null;
  setting?: string;
  suggestion?: string;
  stage?: string;
  /** Failure phase reported by the gateway (e.g. "compute"). */
  phase?: string;
  /** True when the caller should schedule another attempt. */
  retryable?: boolean;
  /** Server-recommended delay before the next attempt. */
  retry_after_seconds?: number;
  /** Structured backoff recommendation for client schedulers. */
  backoff?: { initial_seconds?: number; max_seconds?: number; multiplier?: number; max_total_seconds?: number };
  reconciled_status?: string;
}

function isUsefulPayload(body: EdgeFunctionErrorBody | null | undefined): body is EdgeFunctionErrorBody {
  if (!body || typeof body !== "object") return false;
  return Boolean(
    body.error ||
      body.detail ||
      body.code ||
      body.aws_state ||
      body.azure_error ||
      body.suggestion ||
      body.setting,
  );
}

async function readContextBody(error: unknown): Promise<EdgeFunctionErrorBody | null> {
  const err = error as {
    context?: Response | EdgeFunctionErrorBody | null;
    message?: string;
  } | null;
  const ctx = err?.context;
  if (!ctx) return null;

  // Some supabase-js paths already attach a parsed object (not a Response).
  if (typeof ctx === "object" && !("json" in ctx) && isUsefulPayload(ctx as EdgeFunctionErrorBody)) {
    return ctx as EdgeFunctionErrorBody;
  }

  const resp = ctx as Response;
  if (typeof resp?.json === "function") {
    try {
      const parsed = (await resp.clone().json()) as EdgeFunctionErrorBody;
      if (isUsefulPayload(parsed)) return parsed;
    } catch {
      /* fall through to text */
    }
    try {
      const text = await resp.clone().text();
      if (text) {
        const parsed = JSON.parse(text) as EdgeFunctionErrorBody;
        if (isUsefulPayload(parsed)) return parsed;
      }
    } catch {
      /* non-JSON body */
    }
  }
  return null;
}

/** Unwrap the JSON body of a failed edge-function call (null when unavailable). */
export async function readFunctionErrorPayload(
  error: unknown,
  data?: unknown,
): Promise<EdgeFunctionErrorBody | null> {
  const fromData =
    data && typeof data === "object" ? (data as EdgeFunctionErrorBody) : null;
  const fromCtx = await readContextBody(error);

  // Prefer merging so a partial `data` still picks up detail/code from context.
  if (fromData || fromCtx) {
    const merged: EdgeFunctionErrorBody = { ...(fromCtx ?? {}), ...(fromData ?? {}) };
    if (isUsefulPayload(merged)) return merged;
  }
  return null;
}

export function formatFunctionError(payload: EdgeFunctionErrorBody | null, error: unknown): string {
  if (isUsefulPayload(payload)) {
    const parts: string[] = [];
    if (payload.error) parts.push(payload.error);
    if (payload.code) parts.push(`(${payload.code})`);
    if (payload.detail) parts.push(payload.detail);
    if (payload.aws_state) parts.push(`[aws_state=${payload.aws_state}]`);
    if (payload.provider) parts.push(`[provider=${payload.provider}]`);
    if (payload.setting) parts.push(`Setting to check: ${payload.setting}.`);
    if (payload.suggestion) parts.push(payload.suggestion);
    if (payload.azure_error && payload.azure_error !== payload.error) {
      parts.push(payload.azure_error);
    }
    if (parts.length > 0) return parts.join(" ");
  }
  if (error instanceof Error && error.message) return error.message;
  return "Request failed. Please try again.";
}

export async function readFunctionError(error: unknown, data?: unknown): Promise<string> {
  return formatFunctionError(await readFunctionErrorPayload(error, data), error);
}
