import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_WINDOW_MS = 120_000;

type LogRow = {
  status: string;
  latency_ms: number | null;
  attempts: number | null;
  created_at: string;
};

type Bucket = {
  label: string;
  ts: number;
  calls: number;
  errors: number;
  avgLatency: number;
  failureRate: number;
  retries: number;
};

function buildBuckets(rows: LogRow[], now = Date.now()): Bucket[] {
  const hour = 60 * 60 * 1000;
  const start = now - 24 * hour;
  const buckets: Bucket[] = [];
  for (let i = 0; i < 24; i++) {
    const ts = start + i * hour;
    buckets.push({
      label: new Date(ts).toLocaleTimeString([], { hour: "2-digit" }),
      ts,
      calls: 0,
      errors: 0,
      avgLatency: 0,
      failureRate: 0,
      retries: 0,
    });
  }
  const latencySums = new Array(24).fill(0);
  const latencyCounts = new Array(24).fill(0);

  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.min(23, Math.floor((t - start) / hour));
    const b = buckets[idx];
    b.calls += 1;
    if (row.status === "error") b.errors += 1;
    b.retries += Math.max(0, (row.attempts ?? 1) - 1);
    if (row.latency_ms != null) {
      latencySums[idx] += row.latency_ms;
      latencyCounts[idx] += 1;
    }
  }

  buckets.forEach((b, i) => {
    b.avgLatency = latencyCounts[i] ? Math.round(latencySums[i] / latencyCounts[i]) : 0;
    b.failureRate = b.calls ? Math.round((b.errors / b.calls) * 100) : 0;
  });

  return buckets;
}

/** Recomputes breaker state client-side from the same rule the edge runtime uses. */
function breakerState(rows: LogRow[], now = Date.now()) {
  const recent = rows.filter((r) => now - new Date(r.created_at).getTime() <= CIRCUIT_WINDOW_MS);
  const failures = recent.filter((r) => r.status === "error");
  return { open: failures.length >= CIRCUIT_FAILURE_THRESHOLD, failures: failures.length };
}

export function AiHealthChart() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("ai_request_logs")
        .select("status, latency_ms, attempts, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (!cancelled) {
        setRows((data ?? []) as LogRow[]);
        setLoading(false);
      }
    };
    load();
    const channel = supabase
      .channel("ai-health-metrics")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_request_logs" },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const buckets = useMemo(() => buildBuckets(rows), [rows]);
  const totals = useMemo(() => {
    const calls = rows.length;
    const errors = rows.filter((r) => r.status === "error").length;
    const retries = rows.reduce((sum, r) => sum + Math.max(0, (r.attempts ?? 1) - 1), 0);
    const latencies = rows.filter((r) => r.latency_ms != null).map((r) => r.latency_ms!);
    const avg = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1]) : 0;
    return {
      calls,
      errors,
      retries,
      avg,
      p95,
      failureRate: calls ? Math.round((errors / calls) * 100) : 0,
    };
  }, [rows]);

  const breaker = useMemo(() => breakerState(rows), [rows]);

  const tooltipStyle = {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">AI health — last 24 hours</CardTitle>
            <CardDescription>Latency, failure rate, retries and breaker state.</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              breaker.open
                ? "bg-destructive/15 text-destructive border-destructive/30 gap-1.5"
                : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1.5"
            }
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Breaker {breaker.open ? "open" : "closed"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No AI activity in the last 24 hours"
            description="Metrics appear here once AI insights or the assistant are used."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-5">
              {[
                { label: "Calls", value: totals.calls },
                { label: "Failure rate", value: `${totals.failureRate}%` },
                { label: "Avg latency", value: `${totals.avg} ms` },
                { label: "p95 latency", value: `${totals.p95} ms` },
                { label: "Retries", value: totals.retries },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-lg font-medium text-foreground">{m.value}</p>
                </div>
              ))}
            </div>

            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={buckets}>
                  <defs>
                    <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    unit="%"
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="avgLatency"
                    name="Avg latency (ms)"
                    stroke="hsl(var(--primary))"
                    fill="url(#latencyFill)"
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="failureRate"
                    name="Failure rate (%)"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="retries" name="Retries" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="errors" name="Errors" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
