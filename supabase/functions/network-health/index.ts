// Network Health probes — additive, read-only.
// Probes fixed HTTPS endpoints with a 15s timeout and full TLS verification.
// Green  = HTTP 200 + valid TLS
// Amber  = reachable but degraded (non-200) or timed out
// Red    = TLS failure / DNS / connection refused (never masked or faked)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TIMEOUT_MS = 15_000;

type Health = "green" | "amber" | "red";

interface Target {
  id: string;
  label: string;
  url: string;
}

const TARGETS: Target[] = [
  { id: "hub", label: "Hub", url: "https://skillhub365.co.in/" },
  { id: "guac_aws", label: "Guac AWS", url: "https://guac.skillhub365.co.in/guacamole/" },
  { id: "guac_azure", label: "Guac Azure", url: "https://guac-azure.skillhub365.co.in/guacamole/" },
];

function classifyError(message: string): { status: Health; reason: string } {
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("abort")) {
    return { status: "amber", reason: `No response within ${TIMEOUT_MS / 1000}s (timeout)` };
  }
  if (
    m.includes("certificate") ||
    m.includes("tls") ||
    m.includes("ssl") ||
    m.includes("handshake") ||
    m.includes("invalid peer")
  ) {
    return { status: "red", reason: `TLS verification failed: ${message}` };
  }
  return { status: "red", reason: `Unreachable: ${message}` };
}

async function probe(target: Target) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Deno's fetch verifies TLS by default — an invalid chain throws here.
    const res = await fetch(target.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "SkillHubLabs-NetworkHealth/1" },
    });
    // Drain so the connection closes cleanly.
    await res.arrayBuffer().catch(() => undefined);
    const latencyMs = Date.now() - startedAt;
    if (res.status === 200) {
      return {
        ...target,
        status: "green" as Health,
        httpStatus: res.status,
        tlsValid: true,
        latencyMs,
        reason: `HTTP 200, valid TLS (${latencyMs} ms)`,
      };
    }
    return {
      ...target,
      status: "amber" as Health,
      httpStatus: res.status,
      tlsValid: true,
      latencyMs,
      reason: `Degraded: expected HTTP 200, got HTTP ${res.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { status, reason } = classifyError(message);
    return {
      ...target,
      status,
      httpStatus: null,
      tlsValid: false,
      latencyMs: Date.now() - startedAt,
      reason,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readTarget(req: Request): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get("target");
  if (fromQuery) return fromQuery;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const t = body?.target;
      if (typeof t === "string" && t.trim()) return t.trim();
    } catch {
      // no/invalid body — probe everything
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const requested = await readTarget(req);
    const selected = requested ? TARGETS.filter((t) => t.id === requested) : TARGETS;
    const targets = selected.length > 0 ? selected : TARGETS;
    const checks = await Promise.all(targets.map(probe));
    const overall: Health = checks.some((c) => c.status === "red")
      ? "red"
      : checks.some((c) => c.status === "amber")
        ? "amber"
        : "green";
    return new Response(
      JSON.stringify({ overall, checked_at: new Date().toISOString(), timeout_ms: TIMEOUT_MS, checks }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
