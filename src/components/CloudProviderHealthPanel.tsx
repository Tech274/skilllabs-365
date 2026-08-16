import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Radio,
  XCircle,
  HelpCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type HealthRow = {
  id: string;
  provider: string;
  check_name: string;
  status: "healthy" | "degraded" | "down" | "unconfigured" | string;
  latency_ms: number | null;
  detail: string | null;
  region: string | null;
  checked_at: string;
};

const STATUS_META: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  healthy: { icon: CheckCircle2, className: "text-success", label: "Healthy" },
  degraded: { icon: AlertTriangle, className: "text-warning", label: "Degraded" },
  down: { icon: XCircle, className: "text-destructive", label: "Down" },
  unconfigured: { icon: HelpCircle, className: "text-muted-foreground", label: "Not configured" },
};

const POLL_MS = 60_000;
const WINDOW_MS = 60 * 60 * 1000;

export function CloudProviderHealthPanel() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [live, setLive] = useState(true);
  const [connected, setConnected] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  const load = useCallback(async () => {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("cloud_provider_health_checks")
      .select("*")
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: "Failed to load health metrics", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as HealthRow[]);
    }
    setLoading(false);
  }, []);

  const probe = useCallback(async (silent = false) => {
    setProbing(true);
    const { error } = await supabase.functions.invoke("cloud-provider-health", { method: "POST" });
    setProbing(false);
    if (error && !silent) {
      toast({ title: "Probe failed", description: error.message, variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription — new probe rows stream straight into the panel.
  useEffect(() => {
    const channel = supabase
      .channel("cloud-provider-health")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cloud_provider_health_checks" },
        (payload) => {
          setRows((prev) => [payload.new as HealthRow, ...prev].slice(0, 500));
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Continuous measurement while live mode is on.
  useEffect(() => {
    if (!live) return;
    probe(true);
    const id = window.setInterval(() => {
      if (liveRef.current) probe(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, probe]);

  const latest = useMemo(() => {
    const map = new Map<string, HealthRow>();
    for (const r of rows) {
      const key = `${r.provider}::${r.check_name}`;
      if (!map.has(key)) map.set(key, r);
    }
    return [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.check_name.localeCompare(b.check_name));
  }, [rows]);

  const series = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const r of [...rows].reverse()) {
      const t = new Date(r.checked_at);
      const label = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const key = `${label}|${Math.floor(t.getTime() / 1000)}`;
      const point = byTime.get(key) ?? { label };
      if (r.latency_ms != null) point[`${r.provider}:${r.check_name}`] = r.latency_ms;
      byTime.set(key, point);
    }
    return [...byTime.values()].slice(-40);
  }, [rows]);

  const seriesKeys = useMemo(
    () => latest.filter((r) => r.latency_ms != null).map((r) => `${r.provider}:${r.check_name}`),
    [latest],
  );

  const strokes = ["hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--success))", "hsl(var(--destructive))"];

  const worst = latest.reduce<string>((acc, r) => {
    const rank = { down: 3, degraded: 2, unconfigured: 1, healthy: 0 } as Record<string, number>;
    return (rank[r.status] ?? 0) > (rank[acc] ?? 0) ? r.status : acc;
  }, "healthy");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" /> Realtime provider health
            </CardTitle>
            <CardDescription>
              Live AWS STS and Azure ARM probes with latency history from the last hour.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                connected ? "border-success/40 text-success" : "border-muted-foreground/40 text-muted-foreground",
              )}
            >
              <Radio className={cn("h-3 w-3", connected && "animate-pulse")} />
              {connected ? "Streaming" : "Offline"}
            </Badge>
            <div className="flex items-center gap-2">
              <Switch id="live-probe" checked={live} onCheckedChange={setLive} />
              <Label htmlFor="live-probe" className="text-xs text-muted-foreground">Auto-probe 60s</Label>
            </div>
            <Button size="sm" variant="outline" onClick={() => probe()} disabled={probing}>
              {probing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Probe now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : latest.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No health data yet"
            description="Run a probe to start measuring AWS and Azure availability in realtime."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {latest.map((r) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.unconfigured;
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={`${r.provider}-${r.check_name}`}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-border/50 bg-card/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", meta.className)} />
                        <span className="text-sm font-medium text-foreground">{r.check_name}</span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {r.latency_ms != null ? `${r.latency_ms}ms` : "—"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {r.provider}{r.region ? ` · ${r.region}` : ""}
                      </span>
                      <span className={cn("text-xs font-medium", meta.className)}>{meta.label}</span>
                    </div>
                    {r.detail && <p className="mt-1 truncate text-xs text-muted-foreground">{r.detail}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(r.checked_at).toLocaleTimeString()}
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {series.length > 1 && seriesKeys.length > 0 && (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} unit="ms" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    {seriesKeys.map((k, i) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={strokes[i % strokes.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Overall status:{" "}
              <span className={cn("font-medium", (STATUS_META[worst] ?? STATUS_META.unconfigured).className)}>
                {(STATUS_META[worst] ?? STATUS_META.unconfigured).label}
              </span>
              {" · "}
              {rows.length} checks in the last hour
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
