// Test-only. Do not import this from a function handler.
//
// Serializes process-env overrides. Deno runs test files in parallel and they
// share one process env. Not reentrant: do not call this from inside fn.

let envTail: Promise<void> = Promise.resolve();

export function withLockedEnv<T>(
  vars: Record<string, string | null>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev = envTail;
  let release!: () => void;
  envTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(async () => {
    const saved = new Map<string, string | undefined>();
    for (const key of Object.keys(vars)) saved.set(key, Deno.env.get(key));
    try {
      for (const [key, value] of Object.entries(vars)) {
        if (value === null) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
      return await fn();
    } finally {
      for (const [key, prevVal] of saved) {
        if (prevVal === undefined) Deno.env.delete(key);
        else Deno.env.set(key, prevVal);
      }
      release();
    }
  });
}

export function withCronSecretEnv<T>(value: string | null, fn: () => Promise<T> | T): Promise<T> {
  return withLockedEnv({ CRON_SHARED_SECRET: value }, fn);
}
