import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, requireUser } from "../_shared/auth.ts";
import {
  CIRCUIT_OPEN_MESSAGE,
  DEFAULT_AI_MODEL,
  assertAiEnv,
  callAiGateway,
  checkCircuit,
  logAiRequest,
  newRequestId,
} from "../_shared/ai-runtime.ts";

// Fail fast at boot when the AI configuration is incomplete.
assertAiEnv();



const SYSTEM_PROMPTS: Record<string, string> = {
  cost_insight: `You are a cloud cost optimization advisor for a virtual lab platform running on Azure. Analyze the provided cost and VM data. Give specific, actionable recommendations to reduce spend. Mention exact VM sizes, suggest downgrades or Spot VMs where appropriate. Be concise — use bullet points. Focus on ROI and savings percentages.`,

  security_summary: `You are a cybersecurity analyst reviewing audit logs and WAF events for a cloud lab platform. Summarize threats, flag high-severity patterns, and recommend specific mitigations. Prioritize by severity. Be concise and actionable.`,

  daily_report_summary: `You are a platform operations analyst. Summarize the provided daily report data in 3-5 sentences of plain English. Highlight notable trends: session counts, VM utilization, cleanup activity, quota usage. Call out anything unusual.`,

  lab_description: `You are a technical writer for a cloud education platform. Generate a professional, concise lab description (2-3 sentences) based on the provided lab configuration (name, protocol, VM size, OS image). Describe what the student will learn/practice. Do not use markdown headers.`,

  student_guidance: `You are a friendly AI lab assistant for students on a cloud lab platform. Answer questions about labs, sessions, and best practices. If given session history, suggest what to practice next. Keep responses short and encouraging.`,

  instructor_insight: `You are an analytics assistant for instructors on a cloud lab platform. Analyze student progress data: session counts, durations, disconnect rates, idle times. Identify students who may need help, highlight engagement patterns, and suggest interventions. Be concise.`,

  health_diagnosis: `You are an infrastructure reliability engineer. Analyze the provided service health data (latency, uptime, status). Diagnose potential root causes for any degraded services. Recommend specific troubleshooting steps. Be technical but concise.`,

  audit_anomaly: `You are a security and abuse detection system for a cloud lab platform. Analyze the provided session audit data. Flag any anomalous patterns: rapid VM provisioning, unusual disconnect rates, abnormal session durations, potential abuse. Quantify findings.`,
};

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

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    userId = auth.userId;

    const circuit = await checkCircuit();
    if (circuit.open) {
      console.warn(`[ai-circuit] open (${circuit.failures} recent failures), rejecting request`);
      return json(
        { error: CIRCUIT_OPEN_MESSAGE, retry_after_seconds: circuit.retryAfterSeconds },
        503,
      );
    }

    const { type, data } = await req.json();

    if (!type || !SYSTEM_PROMPTS[type]) {
      return json(
        { error: `Invalid type. Supported: ${Object.keys(SYSTEM_PROMPTS).join(", ")}` },
        400,
      );
    }

    const response = await callAiGateway(
      {
        model: DEFAULT_AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[type] },
          {
            role: "user",
            content: typeof data === "string" ? data : JSON.stringify(data, null, 2),
          },
        ],
        stream: false,
      },
      { apiKey: Deno.env.get("LOVABLE_API_KEY")!, requestId },
    );

    if (!response.ok) {
      const text = await response.text();
      await logAiRequest({
        functionName: "ai-assistant",
        requestId,
        model: DEFAULT_AI_MODEL,
        latencyMs: performance.now() - startedAt,
        status: "error",
        httpStatus: response.status,
        errorType: "gateway_error",
        errorMessage: text,
        userId,
      });

      if (response.status === 429) {
        return json({ error: "AI rate limit exceeded. Please try again in a moment." }, 429);
      }
      if (response.status === 402) {
        return json({ error: "AI credits exhausted. Please add credits to continue." }, 402);
      }
      return json(
        {
          error:
            "The AI service is temporarily unavailable. Please try again in a moment — if it keeps failing, an admin can check AI status.",
        },
        503,
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "No response generated.";

    await logAiRequest({
      functionName: "ai-assistant",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: performance.now() - startedAt,
      status: "success",
      httpStatus: response.status,
      userId,
    });

    return json({ insight: content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logAiRequest({
      functionName: "ai-assistant",
      requestId,
      model: DEFAULT_AI_MODEL,
      latencyMs: performance.now() - startedAt,
      status: "error",
      errorType: "unhandled_error",
      errorMessage: message,
      userId,
    });
    return json(
      { error: "The AI service is temporarily unavailable. Please try again in a moment." },
      503,
    );
  }
});

