import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AuthCtx } from "../_shared/auth.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("CLEANUP_SKIP_SERVE", "1");
const { handleCleanupRequest, logSoftExpiryModeInvalidOnce, resetSoftExpiryModeInvalidLogForTests } = await import("./index.ts");

function emptyClient() {
  const from = () => {
    const result = { data: [], error: null, count: 0 };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of [
      "select", "eq", "is", "in", "or", "order", "limit", "filter",
      "gte", "neq", "not", "lt", "lte", "gt", "range",
    ]) {
      builder[method] = chain;
    }
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    builder.single = () => Promise.resolve({ data: null, error: null });
    for (const op of ["update", "insert", "delete", "upsert"]) builder[op] = chain;
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return builder;
  };
  const client = { from, rpc: () => Promise.resolve({ data: false, error: null }) };
  const auth: AuthCtx = {
    supabase: client as never,
    userId: "00000000-0000-0000-0000-000000000001",
    email: null,
    isServiceRole: true,
  };
  return { client, auth };
}

async function preview(mode: string | null) {
  const saved = Deno.env.get("SOFT_EXPIRY_MODE");
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
  };
  try {
    if (mode === null) Deno.env.delete("SOFT_EXPIRY_MODE");
    else Deno.env.set("SOFT_EXPIRY_MODE", mode);
    const { client, auth } = emptyClient();
    const cloud: string[] = [];
    const res = await handleCleanupRequest(
      new Request("https://example.test/cleanup-idle-labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "expiry-preview" }),
      }),
      { supabase: client, auth, onCloud: (name) => cloud.push(name) },
    );
    const body = await res.json();
    return { status: res.status, body, warnings, cloud };
  } finally {
    console.warn = original;
    if (saved === undefined) Deno.env.delete("SOFT_EXPIRY_MODE");
    else Deno.env.set("SOFT_EXPIRY_MODE", saved);
  }
}

function loggedFallback(warnings: string[]): boolean {
  return warnings.some((line) => line.includes("soft_expiry_mode_invalid"));
}

Deno.test("soft_expiry_mode_invalid is logged once per cold start", () => {
  resetSoftExpiryModeInvalidLogForTests();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
  };
  try {
    assertEquals(logSoftExpiryModeInvalidOnce("unset or empty"), true);
    assertEquals(logSoftExpiryModeInvalidOnce("unknown value"), false);
    assertEquals(logSoftExpiryModeInvalidOnce(null), false);
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0].includes("soft_expiry_mode_invalid"), true);
  } finally {
    console.warn = original;
    resetSoftExpiryModeInvalidLogForTests();
  }
});

Deno.test("cleanup expiry-preview falls back to dry-run and still reports the warning", async () => {
  const unset = await preview(null);
  assertEquals(unset.status, 200);
  assertEquals(unset.body.mode, "dry-run");
  assertEquals(unset.body.mode_configured, null);
  assertEquals(typeof unset.body.mode_warning, "string");
  assertEquals(unset.cloud, []);

  const empty = await preview("");
  assertEquals(empty.body.mode, "dry-run");
  assertEquals(typeof empty.body.mode_warning, "string");
  assertEquals(empty.cloud, []);

  const garbage = await preview("not-a-mode");
  assertEquals(garbage.body.mode, "dry-run");
  assertEquals(garbage.body.mode_configured, "not-a-mode");
  assertEquals(String(garbage.body.mode_warning).includes("not-a-mode"), true);
  assertEquals(garbage.cloud, []);
});

Deno.test("cleanup expiry-preview honours explicit SOFT_EXPIRY_MODE values", async () => {
  for (const mode of ["legacy", "enforce", "dry-run", "off"]) {
    const res = await preview(mode);
    assertEquals(res.status, 200, mode);
    assertEquals(res.body.mode, mode, mode);
    assertEquals(res.body.mode_warning, null, mode);
    assertEquals(loggedFallback(res.warnings), false, mode);
    assertEquals(res.cloud, []);
  }
});
