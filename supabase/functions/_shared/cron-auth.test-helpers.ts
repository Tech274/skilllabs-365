// Test-only. Do not import this from a function handler.
//
// Serializes test overrides of CRON_SHARED_SECRET. Deno runs test files in
// parallel and they share the process env.

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
