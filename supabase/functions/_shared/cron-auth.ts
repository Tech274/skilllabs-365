// Shared cron credential check.
//
// Scheduled callers (cleanup-idle-labs, labs-watchdog, vm-reconcile) are
// accepted when the `x-cron-secret` header equals the `CRON_SHARED_SECRET`
// env var and that env var is non-empty. Comparison is constant-time. Neither
// the header nor the env value is trimmed.

export const CRON_SECRET_HEADER = "x-cron-secret";

/**
 * Constant-time UTF-8 compare. Length mismatches still walk every byte so the
 * secret is not rejected on the first differing character.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) {
    const lv = i < left.length ? left[i] : 0;
    const rv = i < right.length ? right[i] : 0;
    diff |= lv ^ rv;
  }
  return diff === 0;
}

/**
 * True only when `CRON_SHARED_SECRET` is set, non-empty, and the header value
 * matches it. Unset or empty env never matches (including an empty header).
 */
export function cronSecretMatches(header: string | null): boolean {
  const secret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  if (secret.length === 0) return false;
  if (header == null || header.length === 0) return false;
  return timingSafeEqualString(header, secret);
}
