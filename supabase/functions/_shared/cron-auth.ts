// Shared cron credential check.
//
// Jobs 4 (labs-watchdog) and 9 (vm-reconcile) authenticate a scheduled caller
// when the `x-cron-secret` header equals the `CRON_SHARED_SECRET` env var and
// that env var is non-empty. This helper is the same rule with a constant-time
// compare. Those two functions keep their inline checks; cleanup-idle-labs
// uses this helper.

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

// Serializes test overrides of CRON_SHARED_SECRET. Deno runs test files in
// parallel and they share this module and the process env.
let cronEnvTail: Promise<void> = Promise.resolve();

export function withCronSecretEnv<T>(value: string | null, fn: () => Promise<T> | T): Promise<T> {
  const prev = cronEnvTail;
  let release!: () => void;
  cronEnvTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(async () => {
    const saved = Deno.env.get("CRON_SHARED_SECRET");
    try {
      if (value === null) Deno.env.delete("CRON_SHARED_SECRET");
      else Deno.env.set("CRON_SHARED_SECRET", value);
      return await fn();
    } finally {
      if (saved === undefined) Deno.env.delete("CRON_SHARED_SECRET");
      else Deno.env.set("CRON_SHARED_SECRET", saved);
      release();
    }
  });
}
