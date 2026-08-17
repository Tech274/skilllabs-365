import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Download, Loader2, MonitorPlay, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface SessionRow {
  id: string;
  user_id: string | null;
  vm_id: string | null;
  region: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string | null;
  idle_minutes: number;
  reconnects: number | null;
  disconnect_reason: string | null;
  connection_quality: string;
  disconnects: number;
}

interface EventRow {
  id: string;
  session_id: string;
  event_type: string;
  created_at: string;
  event_data: Record<string, unknown> | null;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  completed: "bg-muted text-muted-foreground border-border",
  terminated: "bg-destructive/10 text-destructive border-destructive/30",
};

function durationMinutes(row: SessionRow) {
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(row.started_at).getTime()) / 60000));
}

function toCsv(rows: SessionRow[], events: Record<string, EventRow[]>): string {
  const header = [
    "session_id", "user_id", "vm_id", "region", "status", "started_at", "ended_at",
    "duration_minutes", "idle_minutes", "reconnects", "disconnects", "disconnect_reason",
    "connection_quality", "lifecycle_events",
  ];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    header.join(","),
    ...rows.map((r) => [
      r.id, r.user_id, r.vm_id, r.region, r.status, r.started_at, r.ended_at ?? "",
      durationMinutes(r), r.idle_minutes, r.reconnects ?? 0, r.disconnects, r.disconnect_reason ?? "",
      r.connection_quality,
      (events[r.id] ?? []).map((e) => `${e.event_type}@${e.created_at}`).join(" | "),
    ].map(escape).join(",")),
  ].join("\n");
}

export default function AdminSessionLifecycle() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<Record<string, EventRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(200);
    const list = (sessions ?? []) as unknown as SessionRow[];
    setRows(list);

    if (list.length) {
      const { data: evts } = await supabase
        .from("session_events")
        .select("id, session_id, event_type, created_at, event_data")
        .in("session_id", list.map((s) => s.id))
        .order("created_at", { ascending: true });
      const grouped: Record<string, EventRow[]> = {};
      for (const e of (evts ?? []) as unknown as EventRow[]) {
        (grouped[e.session_id] ??= []).push(e);
      }
      setEvents(grouped);
    } else {
      setEvents({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live lifecycle: new session events update the table without a manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel("session-lifecycle")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_events" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.id, r.region, r.status, r.disconnect_reason]
      .some((v) => v?.toLowerCase().includes(q)));
  }, [rows, search]);

  const summary = useMemo(() => ({
    active: rows.filter((r) => r.status === "active").length,
    reconnects: rows.reduce((a, r) => a + (r.reconnects ?? 0), 0),
    idleEnded: rows.filter((r) => r.disconnect_reason === "idle_timeout").length,
  }), [rows]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered, events)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-lifecycle-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Session Lifecycle</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Guacamole start, reconnect, idle and stop events per session.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
            <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Active sessions", value: summary.active },
            { label: "Total reconnects", value: summary.reconnects },
            { label: "Ended by idle timeout", value: summary.idleEnded },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-semibold text-foreground mt-1">{card.value}</p>
            </div>
          ))}
        </div>

        <Input placeholder="Search session id, region, disconnect reason…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />

        {!loading && filtered.length === 0 ? (
          <EmptyState icon={MonitorPlay} title="No sessions yet"
            description="Lab sessions and their lifecycle events will be listed here." />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Started</th>
                  <th className="text-left p-3">Region</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Duration</th>
                  <th className="text-left p-3">Reconnects</th>
                  <th className="text-left p-3">Disconnect reason</th>
                  <th className="text-left p-3">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.3) }}
                    className="border-b border-border/50 last:border-0 align-top">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()}
                    </td>
                    <td className="p-3">{r.region}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={STATUS_STYLES[r.status] ?? ""}>{r.status}</Badge>
                    </td>
                    <td className="p-3">{durationMinutes(r)}m</td>
                    <td className="p-3">{r.reconnects ?? 0}</td>
                    <td className="p-3 text-muted-foreground">{r.disconnect_reason ?? "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(events[r.id] ?? []).map((e) => (
                          <Badge key={e.id} variant="secondary" className="text-[10px] font-normal"
                            title={new Date(e.created_at).toLocaleString()}>
                            {e.event_type}
                          </Badge>
                        ))}
                        {!(events[r.id] ?? []).length && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
