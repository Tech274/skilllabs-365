import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, requireUser } from "../_shared/auth.ts";


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

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { messages, context } = await req.json();


    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context message
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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: aiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "I'm getting too many requests right now. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service credits exhausted. Please contact your administrator." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
