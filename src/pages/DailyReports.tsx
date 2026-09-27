import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { FileText, Loader2, Server, Activity, Cpu, Trash2, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from "recharts";
import { AiInsightCard } from "@/components/AiInsightCard";
import { UsageSummaryPanel } from "@/components/UsageSummaryPanel";

interface Report {
  id: string;
  report_date: string;
  data: any;
  created_at: string;
}

const DailyReports = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Report | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("daily_reports")
        .select("*")
        .order("report_date", { ascending: false })
        .limit(30);
      if (data) {
        setReports(data as Report[]);
        if (data.length > 0) setSelected(data[0] as Report);
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const trendData = [...reports].reverse().map((r) => ({
    date: r.data?.date || r.report_date,
    sessions: r.data?.sessions_today?.started || 0,
    completed: r.data?.sessions_today?.completed || 0,
    vms: r.data?.vm_summary?.total || 0,
    cleaned: r.data?.cleanup?.vms_cleaned_today || 0,
  }));

  const d = selected?.data;

  const vmStatusData = d?.vm_summary?.by_status
    ? Object.entries(d.vm_summary.by_status).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Usage Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Live lab usage, plus daily snapshots when the daily-report job has run</p>
        </div>

        <UsageSummaryPanel />

        <h2 className="text-lg font-semibold text-foreground pt-2">Daily snapshots</h2>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading snapshots...
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No daily snapshots yet. They appear once the daily-report job is scheduled; live usage above does not depend on it.</p>
          </div>
        ) : (
          <>
            {/* Trend Charts */}
            {trendData.length > 1 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" /> Sessions Over Time
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="sessGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                      <Area type="monotone" dataKey="sessions" stroke="hsl(187 80% 48%)" fill="url(#sessGrad)" strokeWidth={2} name="Started" />
                      <Area type="monotone" dataKey="completed" stroke="hsl(152 60% 45%)" fill="none" strokeWidth={2} strokeDasharray="4 2" name="Completed" />
                    </AreaChart>
                  </ResponsiveContainer>
                </motion.div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-warning" /> Cleanup Actions Over Time
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                      <Bar dataKey="cleaned" fill="hsl(38 90% 55%)" radius={[4, 4, 0, 0]} name="VMs Cleaned" />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              </div>
            )}

            {/* Report List + Detail */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* List */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Report History
                  </h3>
                </div>
                <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
                  {reports.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors ${selected?.id === r.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                    >
                      <p className="text-xs font-medium text-foreground">{r.report_date}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.data?.vm_summary?.total || 0} VMs · {r.data?.sessions_today?.started || 0} sessions
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail */}
              {d && (
                <motion.div
                  key={selected?.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="lg:col-span-2 space-y-4"
                >
                  {/* AI Summary */}
                  {d && (
                    <AiInsightCard
                      type="daily_report_summary"
                      data={d}
                      title="AI Report Summary"
                      buttonLabel="Summarize"
                    />
                  )}

                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Total VMs", value: d.vm_summary?.total || 0, icon: Server },
                      { label: "Sessions Started", value: d.sessions_today?.started || 0, icon: Activity },
                      { label: "Sessions Completed", value: d.sessions_today?.completed || 0, icon: Activity },
                      { label: "VMs Cleaned", value: d.cleanup?.vms_cleaned_today || 0, icon: Trash2 },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                        <m.icon className="h-4 w-4 text-muted-foreground mb-2" />
                        <p className="text-xl font-mono font-semibold text-foreground">{m.value}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{m.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* VM Status Breakdown */}
                  {vmStatusData.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <h4 className="text-sm font-medium text-foreground mb-3">VM Status Breakdown</h4>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={vmStatusData} layout="vertical">
                          <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                          <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} width={90} />
                          <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                          <Bar dataKey="value" fill="hsl(187 80% 48%)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Quota Snapshot */}
                  {d.quota && !d.quota.error && Object.keys(d.quota).length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-primary" /> Quota Snapshot
                      </h4>
                      <div className="space-y-3">
                        {Object.entries(d.quota).map(([region, items]: [string, any]) =>
                          Array.isArray(items) && items.map((q: any) => (
                            <div key={`${region}-${q.name}`} className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground">{q.name}</span>
                                <span className={`text-xs font-mono font-semibold ${q.pct >= 95 ? "text-destructive" : q.pct >= 80 ? "text-warning" : "text-foreground"}`}>
                                  {q.current}/{q.limit} ({q.pct}%)
                                </span>
                              </div>
                              <Progress value={q.pct} className="h-2" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default DailyReports;
