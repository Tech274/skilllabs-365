import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildErrorBreakdown,
  breakdownAlerts,
  type ProvisioningFailureEvent,
} from "@/lib/provisioning-error-breakdown";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

const WINDOWS = [
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
];

export default function AdminProvisioningErrors() {
  const [rows, setRows] = useState<ProvisioningFailureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState("24");

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - Number(windowHours) * 3600_000).toISOString();
    const { data } = await supabase
      .from("provisioning_events")
      .select("id, created_at, correlation_id, step, status, message, vm_id, detail")
      .eq("status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    setRows((data ?? []) as unknown as ProvisioningFailureEvent[]);
    setLoading(false);
  }, [windowHours]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("provisioning-error-breakdown")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "provisioning_events" }, (payload) => {
        const row = payload.new as ProvisioningFailureEvent;
        if (row.status === "failed") setRows((prev) => [row, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const groups = useMemo(() => buildErrorBreakdown(rows), [rows]);
  const windowLabel = WINDOWS.find((w) => w.value === windowHours)?.label.toLowerCase() ?? "the window";
  const alerts = useMemo(() => breakdownAlerts(groups, windowLabel), [groups, windowLabel]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Provisioning Error Breakdown</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Failures grouped by root cause, each linked to the exact setting that has to change.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={windowHours} onValueChange={setWindowHours}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <motion.div
                key={alert.key}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={
                  alert.severity === "critical"
                    ? "flex flex-wrap items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4"
                    : "flex flex-wrap items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4"
                }
              >
                <ShieldAlert className={alert.severity === "critical" ? "mt-0.5 h-4 w-4 text-destructive" : "mt-0.5 h-4 w-4 text-primary"} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{alert.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{alert.message}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={alert.adminPath}>Fix setting <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </motion.div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="No provisioning failures in this window"
            description="Every lab launch in the selected period completed without an error."
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <motion.div
                key={group.errorClass.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline" className="border-destructive/50 text-destructive">
                    {group.count} failure{group.count === 1 ? "" : "s"}
                  </Badge>
                  <h2 className="text-base font-semibold text-foreground">{group.errorClass.title}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">
                    last {new Date(group.lastSeen).toLocaleString()}
                  </span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">{group.errorClass.cause}</p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Causing setting</p>
                    <p className="mt-1 text-sm text-foreground">{group.errorClass.settingLabel}</p>
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link to={group.errorClass.adminPath}>
                        Open setting <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">How to fix</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                      {group.errorClass.fixSteps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent errors</p>
                  {group.samples.map((sample) => (
                    <div key={`${sample.correlationId}-${sample.at}`} className="rounded-md border border-border/60 p-2">
                      <p className="break-words text-xs text-destructive">{sample.message || "(no message)"}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {sample.step} · {sample.correlationId} · {new Date(sample.at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  <Button asChild size="sm" variant="ghost" className="px-0 text-xs">
                    <Link to="/admin/provisioning-status">View full provisioning logs</Link>
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
