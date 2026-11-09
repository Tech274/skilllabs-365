// ST-54: CORS for skilltrack-sso-exchange ONLY. Deliberately independent of the
// shared `corsHeadersFor` / `ALLOWED_ORIGINS` secret: this endpoint hands out a
// sign-in credential, so exactly one browser origin may call it.
// Pure (no Deno/npm imports) so Vitest and Deno can both test it.

export const SSO_ALLOWED_ORIGINS: readonly string[] = Object.freeze(["https://skillhub365.co.in"]);

const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

/** Exact string match only: no wildcards, no subdomains, no http, no trailing slash. */
export function isSsoOriginAllowed(origin: string | null | undefined): origin is string {
  return typeof origin === "string" && SSO_ALLOWED_ORIGINS.includes(origin);
}

/**
 * Headers for an allowed origin. For any other origin (or none) no
 * Access-Control-Allow-Origin is emitted at all, so browsers block the read.
 */
export function ssoCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const base: Record<string, string> = { Vary: "Origin" };
  if (!isSsoOriginAllowed(origin)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "600",
  };
}

/**
 * Gate before any work. Returns a Response to send immediately, or null to proceed.
 *  - preflight from the allowed origin → 204 with CORS headers
 *  - preflight / request from any other origin, or with no Origin → 403, no ACAO
 *    (server-to-server callers have no business here: the SPA is the only client)
 */
export function ssoCorsGate(req: Pick<Request, "method" | "headers">): Response | null {
  const origin = req.headers.get("origin");
  const headers = ssoCorsHeaders(origin);
  if (!isSsoOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return null;
}

/**
 * Run `task` without letting it fail or delay the caller. Uses `waitUntil`
 * (Supabase EdgeRuntime) when given so the isolate keeps it alive after the
 * response; otherwise fire-and-forget. Sync throws and rejections are swallowed.
 */
export function runBestEffort(
  task: () => Promise<unknown>,
  waitUntil?: (p: Promise<unknown>) => void,
  onError: (e: unknown) => void = () => {},
): void {
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(task()).catch(onError);
  } catch (e) {
    onError(e);
    return;
  }
  try {
    waitUntil?.(p);
  } catch {
    /* ignore */
  }
}
