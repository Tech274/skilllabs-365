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
  orgId?: string | null;
  attempts?: number;
};

const REDACTIONS: Array<[RegExp, string]> = [
  // Bearer tokens / API keys / JWTs
  [/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9._\-]{10,}/g, "[redacted-jwt]"],
  [/\b(sk|pk|rk|api)[-_][A-Za-z0-9]{8,}/gi, "[redacted-key]"],
  // Emails
  [/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  // Phone numbers
  [/\+?\d[\d\s\-().]{8,}\d/g, "[redacted-phone]"],
  // IPv4
  [/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[redacted-ip]"],
  // Long free-text blobs of user content quoted by providers
  [/"content"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"content":"[redacted]"'],
];

/**
 * Strip anything that could carry user content or credentials before it is
 * written to the database. Only safe metadata is persisted.
 */
export function redactForLog(input: unknown, maxLength = 500): string | null {
  if (input === null || input === undefined) return null;
  let text = typeof input === "string" ? input : JSON.stringify(input);
  if (!text) return null;
  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Structured console log + durable row in public.ai_request_logs. */
export async function logAiRequest(entry: AiLogEntry): Promise<void> {
  const safeError = redactForLog(entry.errorMessage);
  const line = JSON.stringify({
    scope: "ai",
    fn: entry.functionName,
    request_id: entry.requestId,
    model: entry.model,
    latency_ms: Math.round(entry.latencyMs),
    status: entry.status,
    http_status: entry.httpStatus,
    error_type: entry.errorType,
    attempts: entry.attempts ?? 1,
    error_message: safeError,
  });
  if (entry.status === "error") console.error(line);
  else console.log(line);

  try {
    const supabase = serviceClient();
    await supabase.from("ai_request_logs").insert({
      function_name: entry.functionName,
      request_id: entry.requestId,
      model: entry.model ?? null,
      latency_ms: Math.round(entry.latencyMs),
      status: entry.status,
      http_status: entry.httpStatus ?? null,
      attempts: entry.attempts ?? 1,
      org_id: entry.orgId ?? null,
      error_type: entry.errorType ?? null,
      error_message: safeError,
      user_id: entry.userId && entry.userId !== "00000000-0000-0000-0000-000000000000"
        ? entry.userId
        : null,
    });
  } catch (e) {
    console.error("[ai-log] failed to persist AI log:", e instanceof Error ? e.message : e);
  }
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export const CIRCUIT_FAILURE_THRESHOLD = 5;
/** Failures inside this window count toward the threshold. */
export const CIRCUIT_WINDOW_MS = 120_000;
/** How long calls stay blocked after the breaker trips. */
export const CIRCUIT_OPEN_MS = 60_000;

export type CircuitState = {
  open: boolean;
  failures: number;
  retryAfterSeconds: number;
};

/**
 * Pure evaluation of breaker state from recent log rows (newest first).
 * Trips when >= threshold failures happened inside the window and no success
 * has been recorded since the most recent failure.
 */
export function evaluateCircuit(
  rows: Array<{ status: string; created_at: string }>,
  now = Date.now(),
): CircuitState {
  const recent = rows.filter((r) => now - new Date(r.created_at).getTime() <= CIRCUIT_WINDOW_MS);
  const failures = recent.filter((r) => r.status === "error");
  if (failures.length < CIRCUIT_FAILURE_THRESHOLD) {
    return { open: false, failures: failures.length, retryAfterSeconds: 0 };
  }

  const lastFailureAt = Math.max(...failures.map((r) => new Date(r.created_at).getTime()));
  const successAfter = recent.some(
    (r) => r.status === "success" && new Date(r.created_at).getTime() > lastFailureAt,
  );
  const elapsed = now - lastFailureAt;
  if (successAfter || elapsed >= CIRCUIT_OPEN_MS) {
    return { open: false, failures: failures.length, retryAfterSeconds: 0 };
  }

  return {
    open: true,
    failures: failures.length,
    retryAfterSeconds: Math.ceil((CIRCUIT_OPEN_MS - elapsed) / 1000),
  };
}

/** Reads recent AI logs and decides whether the breaker is open. Fails open. */
export async function checkCircuit(functionName?: string): Promise<CircuitState> {
  try {
    const supabase = serviceClient();
    let query = supabase
      .from("ai_request_logs")
      .select("status, created_at")
      .gte("created_at", new Date(Date.now() - CIRCUIT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    if (functionName) query = query.eq("function_name", functionName);
    const { data, error } = await query;
    if (error || !data) return { open: false, failures: 0, retryAfterSeconds: 0 };
    return evaluateCircuit(data as Array<{ status: string; created_at: string }>);
  } catch {
    return { open: false, failures: 0, retryAfterSeconds: 0 };
  }
}

export const CIRCUIT_OPEN_MESSAGE =
  "The AI service is temporarily paused after repeated failures. Please try again shortly.";


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
  opts: {
    apiKey: string;
    requestId: string;
    maxAttempts?: number;
    /** Mutable counter written with the number of attempts actually made. */
    attemptCounter?: { count: number };
  },
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.attemptCounter) opts.attemptCounter.count = attempt;
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
