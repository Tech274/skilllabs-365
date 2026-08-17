// AI provider health check. Admin-only; reports env config status, a live
// gateway probe, and recent failure counts.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor, corsHeaders, jsonResponse, requireAdmin } from "../_shared/auth.ts";
import { DEGRADED_LATENCY_MS, sendAiAlert, shouldAlert } from "../_shared/ai-alerts.ts";
import {
  DEFAULT_AI_MODEL,
  callAiGateway,
  checkCircuit,
  logAiRequest,
  missingAiEnv,
  newRequestId,
} from "../_shared/ai-runtime.ts";


serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const missing = missingAiEnv();
  if (missing.length > 0) {
    const message = `Missing configuration: ${missing.join(", ")}`;
    await sendAiAlert({ status: "misconfigured", message, latencyMs: null, model: DEFAULT_AI_MODEL });
    return jsonResponse({
      status: "misconfigured",
      model: DEFAULT_AI_MODEL,
      missing_env: missing,
      latency_ms: null,
      circuit_open: false,
      checked_at: new Date().toISOString(),
      message,
    });
  }


  const requestId = newRequestId();
  const startedAt = performance.now();

  try {
    const response = await callAiGateway(
      {
        model: DEFAULT_AI_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      },
      { apiKey: Deno.env.get("LOVABLE_API_KEY")!, requestId, maxAttempts: 1 },
    );
    const latency = performance.now() - startedAt;
    const bodyText = await response.text();

    const ok = response.ok;
    await logAiRequest({
      functionName: "ai-health",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: latency,
      status: ok ? "success" : "error",
      httpStatus: response.status,
      errorType: ok ? undefined : "gateway_error",
      errorMessage: ok ? undefined : bodyText,
      userId: auth.userId,
    });

    const status = ok
      ? "healthy"
      : response.status === 429
      ? "rate_limited"
      : response.status === 402
      ? "no_credits"
      : "degraded";

    const message = ok
      ? latency > DEGRADED_LATENCY_MS
        ? `AI provider responding slowly (${Math.round(latency)}ms)`
        : "AI provider responding normally"
      : `AI provider returned ${response.status}`;

    if (shouldAlert(status, latency)) {
      await sendAiAlert({ status, message, latencyMs: latency, model: DEFAULT_AI_MODEL });
    }

    const circuit = await checkCircuit();

    return jsonResponse({
      status,
      model: DEFAULT_AI_MODEL,
      missing_env: [],
      latency_ms: Math.round(latency),
      http_status: response.status,
      circuit_open: circuit.open,
      circuit_retry_after_seconds: circuit.retryAfterSeconds,
      checked_at: new Date().toISOString(),
      message: circuit.open
        ? `${message}. Circuit breaker open — AI calls paused for ${circuit.retryAfterSeconds}s.`
        : message,
    });
  } catch (e) {
    const latency = performance.now() - startedAt;
    const message = e instanceof Error ? e.message : "Unknown error";
    await logAiRequest({
      functionName: "ai-health",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: latency,
      status: "error",
      errorType: "network_error",
      errorMessage: message,
      userId: auth.userId,
    });
    await sendAiAlert({ status: "unreachable", message, latencyMs: latency, model: DEFAULT_AI_MODEL });
    return jsonResponse({
      status: "unreachable",
      model: DEFAULT_AI_MODEL,
      missing_env: [],
      latency_ms: Math.round(latency),
      circuit_open: true,
      checked_at: new Date().toISOString(),
      message,
    });
  }

});
