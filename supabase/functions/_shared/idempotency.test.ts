import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimIdempotency, IDEMPOTENCY_IN_PROGRESS_TTL_MS, releaseCompletedIdempotency } from "./idempotency.ts";

type Row = {
  idempotency_key: string;
  user_id: string;
  action: string;
  status: string;
  correlation_id: string | null;
  response?: unknown;
  created_at?: string;
};

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
          const removed: Row[] = [];
          for (let i = rows.length - 1; i >= 0; i--) {
            if (match(rows[i])) removed.push(rows.splice(i, 1)[0]);
          }
          return { data: removed, error: null, count: removed.length };
        };
        const del: Record<string, unknown> = {
          eq(k: string, v: unknown) { filters.push([k, v]); return del; },
          select() { return del; },
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

Deno.test("in_progress idempotency claims expire after about 5 minutes", async () => {
  assertEquals(IDEMPOTENCY_IN_PROGRESS_TTL_MS, 5 * 60 * 1000);
  const now = new Date("2026-09-28T00:00:00.000Z");
  const freshAt = new Date(now.getTime() - 60_000).toISOString();
  const staleAt = new Date(now.getTime() - IDEMPOTENCY_IN_PROGRESS_TTL_MS - 1_000).toISOString();

  const fresh: Row[] = [{
    idempotency_key: base.key,
    user_id: "u1",
    action: base.action,
    status: "in_progress",
    correlation_id: "live",
    created_at: freshAt,
  }];
  const stillHeld = await claimIdempotency(fakeDb(fresh), { ...base, correlationId: "retry", now });
  assertEquals(stillHeld.outcome, "in_progress");
  assertEquals(fresh[0].correlation_id, "live");

  const stale: Row[] = [{
    idempotency_key: base.key,
    user_id: "u1",
    action: base.action,
    status: "in_progress",
    correlation_id: "killed",
    created_at: staleAt,
  }];
  const reclaimed = await claimIdempotency(fakeDb(stale), { ...base, correlationId: "retry", now });
  assertEquals(reclaimed.outcome, "new");
  assertEquals(stale.length, 1);
  assertEquals(stale[0].correlation_id, "retry");
  assertEquals(stale[0].status, "in_progress");
  assertEquals(stale[0].created_at, now.toISOString());
});

Deno.test("stale reclaim matches the stored created_at string, not a reformatted timestamp", async () => {
  const now = new Date("2026-09-28T00:00:00.000Z");
  // Postgres-style timestamptz: microseconds and a numeric offset. toISOString()
  // is a different string ("...00.123Z"), so a Date round-trip would miss the row.
  const stored = "2026-09-27T18:50:00.123456+00:00";
  assertEquals(new Date(stored).toISOString() === stored, false);
  const rows: Row[] = [{
    idempotency_key: base.key,
    user_id: "u1",
    action: base.action,
    status: "in_progress",
    correlation_id: "killed",
    created_at: stored,
  }];
  const reclaimed = await claimIdempotency(fakeDb(rows), { ...base, correlationId: "retry", now });
  assertEquals(reclaimed.outcome, "new");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].correlation_id, "retry");
  assertEquals(rows[0].created_at, now.toISOString());
});

Deno.test("two concurrent stale reclaimers: exactly one wins", async () => {
  const now = new Date("2026-09-28T00:00:00.000Z");
  const staleAt = new Date(now.getTime() - IDEMPOTENCY_IN_PROGRESS_TTL_MS - 1_000).toISOString();
  const rows: Row[] = [{
    idempotency_key: base.key,
    user_id: "u1",
    action: base.action,
    status: "in_progress",
    correlation_id: "killed",
    created_at: staleAt,
  }];
  const db = fakeDb(rows);
  const [a, b] = await Promise.all([
    claimIdempotency(db, { ...base, correlationId: "A", now }),
    claimIdempotency(db, { ...base, correlationId: "B", now }),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assertEquals(outcomes, ["in_progress", "new"]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "in_progress");
  assertEquals(rows[0].created_at, now.toISOString());
  assertEquals(rows[0].correlation_id === "A" || rows[0].correlation_id === "B", true);
  const winner = a.outcome === "new" ? "A" : "B";
  assertEquals(rows[0].correlation_id, winner);
});
