import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { ProvisioningTimeline } from "@/components/ProvisioningTimeline";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Activity, Loader2, RefreshCw } from "lucide-react";

interface EventRow {
  id: string;
  created_at: string;
  correlation_id: string;
  source: string;
  step: string;
  status: string;
  message: string | null;
  vm_id: string | null;
  user_id: string | null;
  detail: Record<string, unknown> | null;
}

interface Attempt {
  correlationId: string;
  startedAt: string;
  lastAt: string;
  source: string;
  steps: number;
  status: "running" | "success" | "failed";
  lastError: string | null;
  subnetId: string | null;
  vmId: string | null;
  connectivity: string | null;
}

function summarize(rows: EventRow[]): Attempt[] {
  const groups = new Map<string, EventRow[]>();
  for (const row of rows) {
    const list = groups.get(row.correlation_id) ?? [];
    list.push(row);
    groups.set(row.correlation_id, list);
  }

  return [...groups.entries()]
    .map(([correlationId, list]) => {
      const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const failed = ordered.filter((e) => e.status === "failed");
      const connectivityEvent = ordered.filter((e) => e.step === "connectivity-check").pop();
      const subnetId = ordered
        .map((e) => (e.detail as { subnet_id?: string } | null)?.subnet_id)
        .filter(Boolean)
        .pop() as string | undefined;
      const running = ordered.some((e) => e.status === "running")
        && !ordered.some((e) => e.step === "vm-create" && e.status !== "running")
        && failed.length === 0;

      return {
        correlationId,
        startedAt: ordered[0].created_at,
        lastAt: ordered[ordered.length - 1].created_at,
        source: ordered[0].source,
        steps: ordered.length,
        status: failed.length > 0 ? "failed" : running ? "running" : "success",
        lastError: failed.length > 0 ? failed[failed.length - 1].message : null,
        subnetId: subnetId ?? null,
        vmId: ordered.map((e) => e.vm_id).filter(Boolean).pop() ?? null,
        connectivity: connectivityEvent
          ? `${connectivityEvent.status}: ${connectivityEvent.message ?? ""}`.trim()
          : null,
      } as Attempt;
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

const STATUS_STYLES: Record<Attempt["status"], string> = {
  running: "border-primary/40 text-primary",
  success: "border-primary/30 text-foreground",
  failed: "border-destructive/50 text-destructive",
};

export default function AdminProvisioningStatus() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("provisioning_events")
      .select("id, created_at, correlation_id, source, step, status, message, vm_id, user_id, detail")
      .order("created_at", { ascending: false })
      .limit(500);
    setRows((data ?? []) as EventRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("provisioning-status-stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "provisioning_events" }, (payload) => {
        setRows((prev) => [payload.new as EventRow, ...prev].slice(0, 500));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const attempts = useMemo(() => {
    const all = summarize(rows);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((a) =>
      a.correlationId.toLowerCase().includes(q)
      || (a.vmId ?? "").toLowerCase().includes(q)
      || (a.lastError ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Provisioning Status</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live step-by-step provisioning logs, resolved subnet, and the last error for every attempt.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, VM id or error"
              className="w-56"
            />
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : attempts.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No provisioning attempts yet"
            description="Launch a lab and its step-by-step provisioning log will stream here in real time."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              {attempts.map((attempt) => (
                <motion.button
                  key={attempt.correlationId}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelected(attempt.correlationId)}
                  className={cn(
                    "w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50",
                    selected === attempt.correlationId ? "border-primary" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={STATUS_STYLES[attempt.status]}>{attempt.status}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{attempt.correlationId}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(attempt.lastAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {attempt.source} · {attempt.steps} step{attempt.steps === 1 ? "" : "s"}
                    {attempt.vmId ? ` · vm ${attempt.vmId.slice(0, 8)}` : ""}
                  </p>
                  {attempt.subnetId && (
                    <p className="mt-2 break-all font-mono text-[11px] text-foreground">
                      subnet: {attempt.subnetId}
                    </p>
                  )}
                  {attempt.connectivity && (
                    <p className="mt-1 text-xs text-muted-foreground">connectivity — {attempt.connectivity}</p>
                  )}
                  {attempt.lastError && (
                    <p className="mt-2 text-xs text-destructive">Last error: {attempt.lastError}</p>
                  )}
                </motion.button>
              ))}
            </div>

            <div className="lg:sticky lg:top-4 lg:self-start">
              {selected ? (
                <ProvisioningTimeline correlationId={selected} limit={100} />
              ) : (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Select an attempt to stream its full log.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
