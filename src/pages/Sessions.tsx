import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { Users, Clock, TrendingUp, Timer, Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface SessionRow {
  id: string;
  user_id: string | null;
  status: string;
  region: string;
  idle_minutes: number;
  started_at: string;
  ended_at: string | null;
  vm_id: string | null;
  userName?: string;
  labName?: string;
}

export default function Sessions() {
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");

  // Honor KPI deep-links: /sessions?status=active|completed|all
  useEffect(() => {
    const raw = searchParams.get("status");
    if (!raw) return;
    const normalized = raw.trim().toLowerCase();
    if (normalized) setStatusFilter(normalized);
  }, [searchParams]);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from("sessions")
      .select("*, profiles!sessions_user_id_fkey(display_name), lab_templates(name)")
      .order("started_at", { ascending: false });

    if (error) {
      const { data: fallback } = await supabase.from("sessions").select("*").order("started_at", { ascending: false });
      if (fallback) setSessions(fallback.map((s: any) => ({ ...s, userName: "—", labName: "—" })));
    } else if (data) {
      setSessions(data.map((s: any) => ({
        ...s,
        userName: s.profiles?.display_name || "—",
        labName: s.lab_templates?.name || "—",
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const channel = supabase
      .channel("sessions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => fetchSessions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSessions]);

  const activeSessions = sessions.filter(s => s.status === 'active');
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const avgIdleMinutes = activeSessions.length > 0
    ? (activeSessions.reduce((sum, s) => sum + s.idle_minutes, 0) / activeSessions.length).toFixed(1)
    : "0";

  const filteredSessions = useMemo(() => {
    if (statusFilter === "all") return sessions;
    return sessions.filter((s) => s.status === statusFilter);
  }, [sessions, statusFilter]);

  // Build 24h histogram from real session data
  const sessionHistory = Array.from({ length: 24 }, (_, i) => {
    const hour = `${String(i).padStart(2, '0')}:00`;
    const count = sessions.filter(s => {
      const h = new Date(s.started_at).getHours();
      return h === i;
    }).length;
    return { hour, sessions: count };
  });

  if (!loading && sessions.length === 0) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
            <p className="text-sm text-muted-foreground mt-1">Active Guacamole sessions and analytics</p>
          </div>
          <EmptyState
            icon={Users}
            title="No Sessions Yet"
            description="No lab sessions have been recorded. Sessions appear here in real-time when students launch and connect to labs."
            hint="Tip: Assign a lab template to an instructor, then have a student launch a session."
          />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">Active Guacamole sessions and analytics</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Active Sessions" value={activeSessions.length} icon={Users} variant="success" to="/sessions?status=active" />
          <MetricCard title="Total Sessions" value={sessions.length} icon={TrendingUp} variant="primary" to="/sessions?status=all" />
          <MetricCard title="Avg Idle" value={`${avgIdleMinutes}m`} icon={Timer} variant="warning" subtitle="before auto-stop" to="/vms?status=idle" />
          <MetricCard title="Completed" value={completedSessions.length} icon={Clock} variant="default" to="/sessions?status=completed" />
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4">Session Volume (24h)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={sessionHistory}>
              <defs>
                <linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
              <Area type="monotone" dataKey="sessions" stroke="hsl(187 80% 48%)" fill="url(#sGrad)" strokeWidth={2} name="Sessions" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div id="session-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card">
          <div className="p-5 border-b border-border flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-foreground">
              {statusFilter === "all"
                ? "All Sessions"
                : `${statusFilter.charAt(0).toUpperCase()}${statusFilter.slice(1)} Sessions`}
            </h3>
            <p className="text-xs text-muted-foreground">{filteredSessions.length} shown</p>
          </div>
          {loading ? (
            <div className="p-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading sessions...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['User', 'Lab', 'Region', 'Status', 'Idle', 'Started'].map(h => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">No sessions match this filter.</td></tr>
                  ) : (
                    filteredSessions.map(s => (
                      <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 text-foreground">{s.userName}</td>
                        <td className="px-5 py-3 text-muted-foreground">{s.labName}</td>
                        <td className="px-5 py-3 text-muted-foreground">{s.region}</td>
                        <td className={`px-5 py-3 text-xs font-medium ${s.status === "active" ? "text-success" : "text-muted-foreground"}`}>{s.status}</td>
                        <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{s.idle_minutes}m</td>
                        <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{new Date(s.started_at).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
