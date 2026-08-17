import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor, corsHeaders, requireUser } from "../_shared/auth.ts";
import {
  CIRCUIT_OPEN_MESSAGE,
  DEFAULT_AI_MODEL,
  assertAiEnv,
  callAiGateway,
  checkCircuit,
  logAiRequest,
  newRequestId,
} from "../_shared/ai-runtime.ts";
import { enforceAiQuota } from "../_shared/ai-quota.ts";

// Fail fast at boot when the AI configuration is incomplete.
assertAiEnv();



const SYSTEM_PROMPT = `You are a friendly, knowledgeable AI lab assistant for SkillLabs 365 — a cloud-based virtual lab platform where students practice with real Azure VMs via browser-based RDP/SSH sessions.

Your responsibilities:
- Help students understand their available labs and what they'll learn
- Guide them through connecting to VMs (via Guacamole in-browser RDP/SSH)
- Suggest which lab to try next based on their history and skill level
- Troubleshoot common issues: connection problems, session timeouts, clipboard not working
- Explain cloud computing concepts relevant to their labs
- Encourage and motivate students

You have context about the student's available labs, session history, and progress metrics.

Keep responses concise, warm, and helpful. Use short paragraphs and bullet points where appropriate. Never reveal internal system details like database schemas or API endpoints.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = newRequestId();
  const startedAt = performance.now();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify({ ...(body as object), request_id: requestId }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId },
    });

  let userId: string | null = null;
  let orgId: string | null = null;
  const attemptCounter = { count: 1 };

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    userId = auth.userId;

    const quota = await enforceAiQuota(auth.userId, { isServiceRole: auth.isServiceRole });
    orgId = quota.orgId;
    if (!quota.allowed) {
      console.warn(
        `[ai-quota] blocked ${"ai-chat"} for ${quota.scope} scope (${quota.used}/${quota.limit} per ${quota.window})`,
      );
      await logAiRequest({
        functionName: "ai-chat",
        requestId,
        latencyMs: performance.now() - startedAt,
        status: "error",
        httpStatus: 429,
        errorType: "quota_exceeded",
        errorMessage: `${quota.scope} ${quota.window} quota exceeded (${quota.used}/${quota.limit})`,
        userId,
        orgId,
      });
      return json(
        {
          error: quota.message,
          quota_exceeded: true,
          quota_scope: quota.scope,
          quota_window: quota.window,
          retry_after_seconds: quota.retryAfterSeconds,
        },
        429,
      );
    }

    const circuit = await checkCircuit();
    if (circuit.open) {
      console.warn(`[ai-circuit] open (${circuit.failures} recent failures), rejecting request`);
      return json(
        { error: CIRCUIT_OPEN_MESSAGE, retry_after_seconds: circuit.retryAfterSeconds },
        503,
      );
    }

    const { messages, context } = await req.json();

    const contextMessage = context
      ? `\n\nStudent context:\n${JSON.stringify(context, null, 2)}`
      : "";

    const aiMessages = [
      { role: "system", content: SYSTEM_PROMPT + contextMessage },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const response = await callAiGateway(
      { model: DEFAULT_AI_MODEL, messages: aiMessages, stream: true },
      { apiKey: Deno.env.get("LOVABLE_API_KEY")!, requestId, attemptCounter },
    );

    if (!response.ok) {
      const text = await response.text();
      await logAiRequest({
        functionName: "ai-chat",
        requestId,
        model: DEFAULT_AI_MODEL,
        latencyMs: performance.now() - startedAt,
        status: "error",
        httpStatus: response.status,
        errorType: "gateway_error",
        errorMessage: text,
        userId,
        orgId,
        attempts: attemptCounter.count,
      });

      if (response.status === 429) {
        return json(
          { error: "I'm getting too many requests right now. Please try again in a moment." },
          429,
        );
      }
      if (response.status === 402) {
        return json(
          { error: "AI service credits exhausted. Please contact your administrator." },
          402,
        );
      }
      return json(
        {
          error:
            "The AI assistant is temporarily unavailable. Please try again in a moment — if it keeps failing, an admin can check AI status.",
        },
        503,
      );
    }

    await logAiRequest({
      functionName: "ai-chat",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: performance.now() - startedAt,
      status: "success",
      httpStatus: response.status,
      userId,
      orgId,
      attempts: attemptCounter.count,
    });

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Request-Id": requestId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logAiRequest({
      functionName: "ai-chat",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: performance.now() - startedAt,
      status: "error",
      errorType: "unhandled_error",
      errorMessage: message,
      userId,
      orgId,
      attempts: attemptCounter.count,
    });
    return json(
      { error: "The AI assistant is temporarily unavailable. Please try again in a moment." },
      503,
    );
  }
});

