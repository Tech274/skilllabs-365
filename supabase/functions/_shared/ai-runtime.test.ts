import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  assertAiEnv,
  callAiGateway,
  evaluateCircuit,
  isRetryableStatus,
  missingAiEnv,
  redactForLog,
} from "./ai-runtime.ts";

const REQUIRED = ["LOVABLE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function withEnv(values: Record<string, string | null>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) {
    previous[k] = Deno.env.get(k);
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

// ---------------------------------------------------------------- startup

Deno.test("startup validation reports every missing env var", () => {
  withEnv({ LOVABLE_API_KEY: null, SUPABASE_URL: null, SUPABASE_SERVICE_ROLE_KEY: null }, () => {
    assertEquals(missingAiEnv().sort(), [...REQUIRED].sort());
  });
});

Deno.test("startup validation throws when configuration is incomplete", () => {
  withEnv(
    { LOVABLE_API_KEY: null, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "svc" },
    () => {
      let threw = false;
      try {
        assertAiEnv();
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes("LOVABLE_API_KEY"));
      }
      assert(threw, "assertAiEnv should throw when LOVABLE_API_KEY is missing");
    },
  );
});

Deno.test("startup validation passes when fully configured", () => {
  withEnv(
    { LOVABLE_API_KEY: "k", SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "svc" },
    () => {
      assertEquals(missingAiEnv(), []);
      assertAiEnv();
    },
  );
});

// ---------------------------------------------------------------- redaction

Deno.test("redaction strips emails, tokens, ips and user content", () => {
  const raw =
    'Failed for user jane.doe@example.com with Authorization: Bearer abc.def123 from 10.1.2.3 body {"content":"my private prompt about salary"} phone +1 415 555 2671';
  const safe = redactForLog(raw)!;
  assert(!safe.includes("jane.doe@example.com"));
  assert(!safe.includes("abc.def123"));
  assert(!safe.includes("10.1.2.3"));
  assert(!safe.includes("private prompt"));
  assert(!safe.includes("555 2671"));
  assert(safe.includes("[redacted-email]"));
});

Deno.test("redaction strips JWTs and truncates long payloads", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
  assert(!redactForLog(`token ${jwt}`)!.includes("signaturepart"));
  const long = redactForLog("a".repeat(2000))!;
  assert(long.length <= 501);
});

Deno.test("redaction returns null for empty input", () => {
  assertEquals(redactForLog(null), null);
  assertEquals(redactForLog(undefined), null);
});

// ---------------------------------------------------------------- retries

Deno.test("callAiGateway retries transient failures then succeeds", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((..._args: unknown[]) => {
    calls += 1;
    if (calls < 3) return Promise.resolve(new Response("busy", { status: 503 }));
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }) as typeof fetch;

  try {
    const res = await callAiGateway({}, { apiKey: "k", requestId: "r1" });
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callAiGateway does not retry terminal errors", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response("bad request", { status: 400 }));
  }) as typeof fetch;

  try {
    const res = await callAiGateway({}, { apiKey: "k", requestId: "r2" });
    await res.text();
    assertEquals(res.status, 400);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callAiGateway stops after maxAttempts and backs off between tries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const startedAt = Date.now();
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response("boom", { status: 500 }));
  }) as typeof fetch;

  try {
    const res = await callAiGateway({}, { apiKey: "k", requestId: "r3", maxAttempts: 3 });
    await res.text();
    assertEquals(calls, 3);
    assert(Date.now() - startedAt >= 700, "expected exponential backoff delays between attempts");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("retryable status classification", () => {
  assert(isRetryableStatus(429));
  assert(isRetryableStatus(500));
  assert(isRetryableStatus(503));
  assertEquals(isRetryableStatus(400), false);
  assertEquals(isRetryableStatus(402), false);
});

// ---------------------------------------------------------------- breaker

const at = (now: number, secondsAgo: number) =>
  new Date(now - secondsAgo * 1000).toISOString();

Deno.test("circuit stays closed below the failure threshold", () => {
  const now = Date.now();
  const rows = Array.from({ length: CIRCUIT_FAILURE_THRESHOLD - 1 }, (_, i) => ({
    status: "error",
    created_at: at(now, i + 1),
  }));
  assertEquals(evaluateCircuit(rows, now).open, false);
});

Deno.test("circuit opens after repeated failures inside the window", () => {
  const now = Date.now();
  const rows = Array.from({ length: CIRCUIT_FAILURE_THRESHOLD }, (_, i) => ({
    status: "error",
    created_at: at(now, i + 1),
  }));
  const state = evaluateCircuit(rows, now);
  assert(state.open);
  assert(state.retryAfterSeconds > 0 && state.retryAfterSeconds <= 60);
});

Deno.test("circuit closes again once the open window elapses", () => {
  const now = Date.now();
  const rows = Array.from({ length: CIRCUIT_FAILURE_THRESHOLD }, (_, i) => ({
    status: "error",
    created_at: at(now, 70 + i),
  }));
  assertEquals(evaluateCircuit(rows, now).open, false);
});

Deno.test("a success after the last failure closes the circuit", () => {
  const now = Date.now();
  const rows = [
    { status: "success", created_at: at(now, 1) },
    ...Array.from({ length: CIRCUIT_FAILURE_THRESHOLD }, (_, i) => ({
      status: "error",
      created_at: at(now, i + 5),
    })),
  ];
  assertEquals(evaluateCircuit(rows, now).open, false);
});
