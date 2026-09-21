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
}

/** Unwrap the JSON body of a failed edge-function call (null when unavailable). */
export async function readFunctionErrorPayload(
  error: unknown,
  data?: unknown,
): Promise<EdgeFunctionErrorBody | null> {
  const body = (data && typeof data === "object" ? (data as EdgeFunctionErrorBody) : null) ?? null;
  if (body?.error) return body;

  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      return (await ctx.clone().json()) as EdgeFunctionErrorBody;
    } catch {
      /* non-JSON body */
    }
  }
  return null;
}

export function formatFunctionError(payload: EdgeFunctionErrorBody | null, error: unknown): string {
  if (payload?.error) {
    const parts = [payload.error];
    if (payload.code) parts.push(`(${payload.code})`);
    if (payload.detail) parts.push(payload.detail);
    if (payload.aws_state) parts.push(`[aws_state=${payload.aws_state}]`);
    if (payload.provider) parts.push(`[provider=${payload.provider}]`);
    if (payload.setting) parts.push(`Setting to check: ${payload.setting}.`);
    if (payload.suggestion) parts.push(payload.suggestion);
    return parts.join(" ");
  }
  if (error instanceof Error) return error.message;
  return "Request failed. Please try again.";
}

export async function readFunctionError(error: unknown, data?: unknown): Promise<string> {
  return formatFunctionError(await readFunctionErrorPayload(error, data), error);
}
