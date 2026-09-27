import { describe, expect, it } from "vitest";
import { chunk, fetchAllForIds, fetchAllPages } from "@/lib/paged-query";

function table(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

describe("fetchAllPages (SCRUM-107)", () => {
  it("returns every row beyond the 1000-row cap", async () => {
    const rows = table(2345);
    const calls: Array<[number, number]> = [];
    const res = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(res.data).toEqual(rows);
    expect(res.truncated).toBe(false);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops on an exact multiple with one empty page", async () => {
    const rows = table(2000);
    const res = await fetchAllPages<number>(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(res.data.length).toBe(2000);
  });

  it("surfaces errors with the rows loaded so far", async () => {
    const res = await fetchAllPages<number>(async (from, to) =>
      from === 0 ? { data: table(1000), error: null } : { data: null, error: { message: "boom" } },
    );
    expect(res.data.length).toBe(1000);
    expect(res.error?.message).toBe("boom");
  });

  it("flags truncation at the hard cap", async () => {
    const res = await fetchAllPages<number>(async (from, to) => ({ data: table(to - from + 1), error: null }), 10, 30);
    expect(res.data.length).toBe(30);
    expect(res.truncated).toBe(true);
  });
});

describe("chunk / fetchAllForIds", () => {
  it("chunks ids", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("pages each id chunk and concatenates", async () => {
    const ids = table(250);
    const seen: number[][] = [];
    const res = await fetchAllForIds<number, number>(ids, async (part, from, to) => {
      if (from === 0) seen.push(part);
      return { data: part.slice(from, to + 1), error: null };
    });
    expect(seen.map((s) => s.length)).toEqual([100, 100, 50]);
    expect(res.data).toEqual(ids);
  });
});

describe("dedupeBy (offset-paging drift)", () => {
  it("keeps the first row per key", async () => {
    const { dedupeBy } = await import("@/lib/paged-query");
    expect(dedupeBy([{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 1, v: "c" }], (r) => r.id)).toEqual([
      { id: 1, v: "a" },
      { id: 2, v: "b" },
    ]);
  });
});
