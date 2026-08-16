import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AiHealthChart } from "@/components/AiHealthChart";
import { AiQuotaManager } from "@/components/AiQuotaManager";
import { AiAlertDeliveries } from "@/components/AiAlertDeliveries";

interface HealthPayload {
  status: string;
  model: string;
  missing_env: string[];
  latency_ms: number | null;
  http_status?: number;
  circuit_open?: boolean;
  circuit_retry_after_seconds?: number;
  checked_at: string;
  message: string;
}

interface AiLogRow {
  id: string;
  function_name: string;
  request_id: string | null;
  model: string | null;
  latency_ms: number | null;
  status: string;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  healthy: { label: "Operational", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  degraded: { label: "Degraded", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  rate_limited: { label: "Rate limited", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  no_credits: { label: "Credits exhausted", className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  misconfigured: { label: "Misconfigured", className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  unreachable: { label: "Unreachable", className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
};

export default function AiStatus() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [logs, setLogs] = useState<AiLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const runHealthCheck = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-health", { body: {} });
      if (error) throw error;
      setHealth(data as HealthPayload);
    } catch (err: any) {
      toast({
        title: "Health check failed",
        description: err?.message || "Could not reach the AI health endpoint.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    const { data, error } = await supabase
      .from("ai_request_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Could not load AI logs", description: error.message, variant: "destructive" });
    } else {
      setLogs((data ?? []) as AiLogRow[]);
    }
    setLoadingLogs(false);
  }, []);

  useEffect(() => {
    runHealthCheck();
    loadLogs();
  }, [runHealthCheck, loadLogs]);

  const meta = health ? STATUS_META[health.status] ?? STATUS_META.degraded : null;
  const StatusIcon = meta?.icon ?? Activity;
  const failures = logs.filter((l) => l.status === "error");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Status
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live AI provider health and recent AI request failures.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadLogs} disabled={loadingLogs} className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
              Refresh logs
            </Button>
            <Button size="sm" onClick={runHealthCheck} disabled={checking} className="gap-2">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              Run health check
            </Button>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Provider health</CardTitle>
                  <CardDescription>{health?.model ?? "—"}</CardDescription>
                </div>
                {meta && (
                  <Badge variant="outline" className={`gap-1.5 ${meta.className}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {meta.label}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Latency</p>
                <p className="text-lg font-medium text-foreground">
                  {health?.latency_ms != null ? `${health.latency_ms} ms` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last checked</p>
                <p className="text-lg font-medium text-foreground">
                  {health ? new Date(health.checked_at).toLocaleTimeString() : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failures (last 50 calls)</p>
                <p className="text-lg font-medium text-foreground">{failures.length}</p>
              </div>
              {health?.message && (
                <p className="sm:col-span-3 text-sm text-muted-foreground">{health.message}</p>
              )}
              {health?.circuit_open ? (
                <p className="sm:col-span-3 text-sm text-amber-400">
                  Circuit breaker open — AI calls are paused
                  {health.circuit_retry_after_seconds
                    ? ` for ${health.circuit_retry_after_seconds}s`
                    : ""} after repeated failures.
                </p>
              ) : null}
              {health?.missing_env?.length ? (
                <p className="sm:col-span-3 text-sm text-destructive">
                  Missing configuration: {health.missing_env.join(", ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <AiHealthChart />

        <AiQuotaManager />

        <AiAlertDeliveries />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent AI requests</CardTitle>
            <CardDescription>Latest 50 AI calls with request ids, model, and latency.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingLogs ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No AI requests logged yet"
                description="Requests appear here as soon as the AI assistant or insights are used."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Function</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Request ID</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{log.function_name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              log.status === "error"
                                ? "bg-destructive/15 text-destructive border-destructive/30"
                                : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            }
                          >
                            {log.status}
                            {log.http_status ? ` ${log.http_status}` : ""}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.latency_ms != null ? `${log.latency_ms} ms` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{log.model ?? "—"}</TableCell>
                        <TableCell className="text-[11px] font-mono text-muted-foreground">
                          {log.request_id?.slice(0, 8) ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate text-muted-foreground">
                          {log.error_message ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
