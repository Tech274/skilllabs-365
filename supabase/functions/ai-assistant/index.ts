import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, requireUser } from "../_shared/auth.ts";
import {
  DEFAULT_AI_MODEL,
  assertAiEnv,
  callAiGateway,
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

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { type, data } = await req.json();


    if (!type || !SYSTEM_PROMPTS[type]) {
      return new Response(
        JSON.stringify({ error: `Invalid type. Supported: ${Object.keys(SYSTEM_PROMPTS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[type] },
          {
            role: "user",
            content: typeof data === "string" ? data : JSON.stringify(data, null, 2),
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "No response generated.";

    return new Response(
      JSON.stringify({ insight: content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
