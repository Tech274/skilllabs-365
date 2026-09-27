/**
 * SCRUM-107 — PostgREST caps every response (1000 rows on Supabase). Admin
 * fleet views must page until exhausted instead of silently truncating, and
 * must chunk large `.in(...)` id lists so the request URL stays small.
 */

export const PAGE_SIZE = 1000;
/** `.in()` id lists per request (UUIDs ≈ 37 chars → ~3.7 KB per chunk). */
export const IN_CHUNK = 100;
/** Hard stop so a runaway table cannot hang the admin page. */
export const MAX_ROWS = 50_000;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export interface PagedResult<T> {
  data: T[];
  error: { message: string } | null;
  /** true when MAX_ROWS was hit and more rows may exist. */
  truncated: boolean;
}

/**
 * Call `fetchPage(from, to)` (inclusive range, e.g. `.range(from, to)`) until a
 * short page comes back. Callers must apply a stable order so pages do not
 * overlap or skip rows.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
  maxRows = MAX_ROWS,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { data: out, error, truncated: false };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) return { data: out, error: null, truncated: false };
  }
  return { data: out, error: null, truncated: true };
}

export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Page every chunk of `ids` and concatenate (chunks run sequentially). */
export async function fetchAllForIds<T, I>(
  ids: readonly I[],
  fetchPage: (idChunk: I[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = IN_CHUNK,
  pageSize = PAGE_SIZE,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  let truncated = false;
  for (const part of chunk(ids, chunkSize)) {
    const res = await fetchAllPages<T>((from, to) => fetchPage(part, from, to), pageSize);
    out.push(...res.data);
    truncated = truncated || res.truncated;
    if (res.error) return { data: out, error: res.error, truncated };
  }
  return { data: out, error: null, truncated };
}

/**
 * Drop repeated rows by key (first wins). Offset paging is not snapshot
 * consistent: an insert between pages shifts rows, so one can appear twice.
 */
export function dedupeBy<T>(rows: readonly T[], key: (row: T) => unknown): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Serialise an async loader: a call while one run is in flight queues exactly
 * ONE follow-up run (so the latest state is always loaded) instead of starting
 * an overlapping run that could finish out of order.
 */
export function coalesceRuns(run: () => Promise<void>): () => Promise<void> {
  let running = false;
  let queued = false;
  return async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      do {
        queued = false;
        await run();
      } while (queued);
    } finally {
      running = false;
    }
  };
}
