import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimIdempotency, releaseCompletedIdempotency } from "./idempotency.ts";

type Row = { idempotency_key: string; user_id: string; action: string; status: string; correlation_id: string | null; response?: unknown };

/** Tiny in-memory stand-in for the provisioning_idempotency table. */
function fakeDb(rows: Row[]) {
  const from = (_table: string) => {
    const filters: Array<[string, unknown]> = [];
    const match = (r: Row) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v);
    const builder: Record<string, unknown> = {
      eq(k: string, v: unknown) { filters.push([k, v]); return builder; },
      select() { return builder; },
      maybeSingle() { return Promise.resolve({ data: rows.find(match) ?? null, error: null }); },
      delete() {
        const run = () => {
          for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
          return { error: null };
        };
        const del: Record<string, unknown> = {
          eq(k: string, v: unknown) { filters.push([k, v]); return del; },
          then(res: (v: unknown) => unknown) { return Promise.resolve(run()).then(res); },
        };
        return del;
      },
      insert(row: Row) {
        const dup = rows.some((r) => r.idempotency_key === row.idempotency_key && r.user_id === row.user_id && r.action === row.action);
        if (dup) return Promise.resolve({ error: { code: "23505", message: "dup" } });
        rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const base = { key: "guac-session:vm1", userId: "u1", action: "guac-create-session" };

Deno.test("two stale-replay Connects: only one re-mints, the other sees in_progress", async () => {
  const rows: Row[] = [{ idempotency_key: base.key, user_id: "u1", action: base.action, status: "completed", correlation_id: "old", response: { session_id: "s-old" } }];
  const db = fakeDb(rows);

  // A drops the stale row and re-claims.
  await releaseCompletedIdempotency(db, { ...base, correlationId: "old" });
  const a = await claimIdempotency(db, { ...base, correlationId: "A" });
  assertEquals(a.outcome, "new");

  // B saw the same stale replay; its release must NOT delete A's in-progress claim.
  await releaseCompletedIdempotency(db, { ...base, correlationId: "old" });
  const b = await claimIdempotency(db, { ...base, correlationId: "B" });
  assertEquals(b.outcome, "in_progress");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].correlation_id, "A");
});

Deno.test("release never touches an in-progress claim even without a correlation id", async () => {
  const rows: Row[] = [{ idempotency_key: base.key, user_id: "u1", action: base.action, status: "in_progress", correlation_id: "A" }];
  await releaseCompletedIdempotency(fakeDb(rows), { ...base });
  assertEquals(rows.length, 1);
});
