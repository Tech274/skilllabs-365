/**
 * Client-side idempotency keys.
 *
 * A key is stable for a given scope (e.g. `provision:<templateId>`) for a short
 * window, so double clicks, retries and reloads reuse the same key and the Edge
 * Function replays the original result instead of creating a duplicate VM or
 * Guacamole connection.
 */
const WINDOW_MS = 10 * 60 * 1000;
const STORAGE_PREFIX = "idem:";

function makeKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Get (or create) the idempotency key currently active for `scope`. */
export function idempotencyKey(scope: string): string {
  const storageKey = STORAGE_PREFIX + scope;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { key: string; at: number };
      if (parsed.key && Date.now() - parsed.at < WINDOW_MS) return parsed.key;
    }
  } catch {
    // sessionStorage unavailable (private mode / SSR) — fall through to a fresh key.
  }
  const key = makeKey();
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ key, at: Date.now() }));
  } catch {
    // ignore
  }
  return key;
}

/** Headers to attach to an Edge Function invocation. */
export function idempotencyHeaders(scope: string): Record<string, string> {
  return { "Idempotency-Key": idempotencyKey(scope) };
}

/**
 * A brand-new key for this click. Remint must not reuse the 10-minute window:
 * a stored completed 200 would replay and skip StartInstances.
 * The key is still written under the scope so an IDEMPOTENCY_IN_PROGRESS
 * response can leave it in place. Other failures, including other 409s, drop it.
 */
export function freshIdempotencyHeaders(scope: string): Record<string, string> {
  const key = makeKey();
  try {
    sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify({ key, at: Date.now() }));
  } catch {
    // sessionStorage unavailable — the header is still a fresh key.
  }
  return { "Idempotency-Key": key };
}

/** Drop the stored key so the next attempt starts a brand new operation. */
export function resetIdempotency(scope: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + scope);
  } catch {
    // ignore
  }
}
