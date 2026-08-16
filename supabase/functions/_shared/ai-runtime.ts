// Shared runtime helpers for AI edge functions:
// 1. Startup-time env validation (fails the boot instead of a runtime 500)
// 2. Structured logging of every AI gateway call into public.ai_request_logs
// 3. Retry with exponential backoff for transient gateway failures
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const DEFAULT_AI_MODEL = "google/gemini-3.6-flash";

/** Env vars every AI edge function requires. Missing values throw at boot. */
const REQUIRED_AI_ENV = ["LOVABLE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export function missingAiEnv(): string[] {
  return REQUIRED_AI_ENV.filter((name) => !Deno.env.get(name)?.trim());
}

/**
 * Call at module scope. Throws during function boot when configuration is
 * incomplete, so a broken deployment fails fast and loudly.
 */
export function assertAiEnv(): void {
  const missing = missingAiEnv();
  if (missing.length > 0) {
    const message = `[ai-startup] Missing required environment variables: ${missing.join(", ")}`;
    console.error(message);
    throw new Error(message);
  }
  console.log("[ai-startup] AI environment validated");
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export type AiLogEntry = {
  functionName: string;
  requestId: string;
  model?: string;
  latencyMs: number;
  status: "success" | "error";
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  userId?: string | null;
};

/** Structured console log + durable row in public.ai_request_logs. */
export async function logAiRequest(entry: AiLogEntry): Promise<void> {
  const line = JSON.stringify({
    scope: "ai",
    fn: entry.functionName,
    request_id: entry.requestId,
    model: entry.model,
    latency_ms: entry.latencyMs,
    status: entry.status,
    http_status: entry.httpStatus,
    error_type: entry.errorType,
    error_message: entry.errorMessage,
  });
  if (entry.status === "error") console.error(line);
  else console.log(line);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await supabase.from("ai_request_logs").insert({
      function_name: entry.functionName,
      request_id: entry.requestId,
      model: entry.model ?? null,
      latency_ms: Math.round(entry.latencyMs),
      status: entry.status,
      http_status: entry.httpStatus ?? null,
      error_type: entry.errorType ?? null,
      error_message: entry.errorMessage ? entry.errorMessage.slice(0, 2000) : null,
      user_id: entry.userId && entry.userId !== "00000000-0000-0000-0000-000000000000"
        ? entry.userId
        : null,
    });
  } catch (e) {
    console.error("[ai-log] failed to persist AI log:", e instanceof Error ? e.message : e);
  }
}

/** 429 and 5xx are transient; everything else is terminal. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to the AI gateway with exponential backoff (250ms, 500ms, 1000ms + jitter)
 * on transient failures. Returns the final response (may still be an error).
 */
export async function callAiGateway(
  body: unknown,
  opts: { apiKey: string; requestId: string; maxAttempts?: number },
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          "X-Request-Id": opts.requestId,
        },
        body: JSON.stringify(body),
      });

      if (response.ok || !isRetryableStatus(response.status) || attempt === maxAttempts) {
        return response;
      }
      await response.body?.cancel();
      console.warn(
        `[ai-retry] attempt ${attempt}/${maxAttempts} got ${response.status}, retrying`,
      );
    } catch (e) {
      lastError = e;
      if (attempt === maxAttempts) throw e;
      console.warn(`[ai-retry] attempt ${attempt}/${maxAttempts} network error, retrying`);
    }
    await sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150));
  }

  throw lastError ?? new Error("AI gateway request failed");
}
