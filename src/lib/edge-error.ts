/**
 * Supabase edge-function errors surface as "Edge Function returned a non-2xx
 * status code", which hides the real reason from the user. This unwraps the
 * response body so the UI can show the actual message the function returned.
 */
export async function edgeErrorMessage(error: unknown, fallback = "Unknown error"): Promise<string> {
  if (!error) return fallback;
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).text === "function") {
    try {
      const raw = await (ctx as Response).clone().text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const msg = parsed.error ?? parsed.message;
          if (typeof msg === "string" && msg.trim()) return msg;
        } catch {
          if (raw.trim() && !raw.includes("<html")) return raw.trim().slice(0, 400);
        }
      }
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Narrows an unknown `catch` value to a displayable message. */
export function errorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}
