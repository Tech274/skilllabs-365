/**
 * Shaping helpers for the readiness polling dashboard.
 *
 * The edge function returns minute buckets; charts want hourly (or finer)
 * series and the CSV export wants a flat table. All pure — the alert logic
 * itself lives server-side in `_shared/readiness-metrics.ts`.
 */

export type ReadinessMetricName =
  | "cache_hit"
  | "cache_miss"
  | "cache_stale"
  | "rate_limited"
  | "publish_blocked"
  | "forbidden";

export const READINESS_METRIC_ORDER: ReadinessMetricName[] = [
  "cache_hit",
  "cache_miss",
  "cache_stale",
  "rate_limited",
  "publish_blocked",
  "forbidden",
];

export const READINESS_METRIC_LABELS: Record<ReadinessMetricName, string> = {
  cache_hit: "Cache hits",
  cache_miss: "Cache misses",
  cache_stale: "Stale served",
  rate_limited: "429 / Retry-After",
  publish_blocked: "Publish blocked",
  forbidden: "Forbidden",
};

export interface ReadinessMetricRow {
  bucket_minute: string;
  metric: string;
  provider: string | null;
  template_id: string | null;
  count: number;
}

export interface ReadinessSummary {
  totals: Record<string, number>;
  calls: number;
  cacheHitRatio: number;
  rateLimitedRatio: number;
  windowHours: number;
}

export interface ReadinessAlert {
  metric: string;
  severity: "warning" | "critical";
  value: number;
  threshold: number;
  message: string;
}

export interface SeriesPoint {
  bucket: string;
  label: string;
  cache_hit: number;
  cache_miss: number;
  cache_stale: number;
  rate_limited: number;
  publish_blocked: number;
  forbidden: number;
  total: number;
}

const EMPTY = (): Omit<SeriesPoint, "bucket" | "label"> => ({
  cache_hit: 0, cache_miss: 0, cache_stale: 0,
  rate_limited: 0, publish_blocked: 0, forbidden: 0, total: 0,
});

/** Rolls minute buckets up into fixed-size buckets (minutes) for charting. */
export function bucketSeries(rows: ReadinessMetricRow[], bucketMinutes = 60): SeriesPoint[] {
  const size = Math.max(1, bucketMinutes) * 60_000;
  const map = new Map<number, SeriesPoint>();

  for (const row of rows) {
    const ts = new Date(row.bucket_minute).getTime();
    if (Number.isNaN(ts)) continue;
    const start = Math.floor(ts / size) * size;
    let point = map.get(start);
    if (!point) {
      const d = new Date(start);
      point = {
        bucket: d.toISOString(),
        label: d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        ...EMPTY(),
      };
      map.set(start, point);
    }
    if ((READINESS_METRIC_ORDER as string[]).includes(row.metric)) {
      point[row.metric as ReadinessMetricName] += row.count ?? 0;
      point.total += row.count ?? 0;
    }
  }

  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Percentage of served responses answered from cache (hit or stale). */
export function cacheHitRatio(totals: Record<string, number>): number {
  const served = (totals.cache_hit ?? 0) + (totals.cache_miss ?? 0) + (totals.cache_stale ?? 0);
  if (served === 0) return 0;
  return ((totals.cache_hit ?? 0) + (totals.cache_stale ?? 0)) / served;
}

/** Templates ranked by how much readiness traffic they generate. */
export function topTemplates(rows: ReadinessMetricRow[], limit = 5) {
  const map = new Map<string, { template_id: string; provider: string | null; total: number; rate_limited: number }>();
  for (const row of rows) {
    if (!row.template_id) continue;
    const entry = map.get(row.template_id) ?? {
      template_id: row.template_id, provider: row.provider, total: 0, rate_limited: 0,
    };
    entry.total += row.count ?? 0;
    if (row.metric === "rate_limited") entry.rate_limited += row.count ?? 0;
    if (!entry.provider && row.provider) entry.provider = row.provider;
    map.set(row.template_id, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export function toMetricsCsv(rows: ReadinessMetricRow[]): string {
  const header = ["bucket_minute", "metric", "provider", "template_id", "count"];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) =>
    [r.bucket_minute, r.metric, r.provider, r.template_id, r.count].map(escape).join(",")
  );
  return [header.join(","), ...body].join("\n");
}
