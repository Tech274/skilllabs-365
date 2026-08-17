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
  setting?: string;
  suggestion?: string;
  stage?: string;
}

export async function readFunctionError(error: unknown, data?: unknown): Promise<string> {
  const body = (data && typeof data === "object" ? (data as EdgeFunctionErrorBody) : null) ?? null;
  let payload: EdgeFunctionErrorBody | null = body?.error ? body : null;

  const ctx = (error as { context?: Response } | null)?.context;
  if (!payload && ctx && typeof ctx.json === "function") {
    try {
      payload = (await ctx.clone().json()) as EdgeFunctionErrorBody;
    } catch {
      /* non-JSON body */
    }
  }

  if (payload?.error) {
    const parts = [payload.error];
    if (payload.setting) parts.push(`Setting to check: ${payload.setting}.`);
    if (payload.suggestion) parts.push(payload.suggestion);
    return parts.join(" ");
  }

  if (error instanceof Error) return error.message;
  return "Request failed. Please try again.";
}
