import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Monitor, Terminal, Wifi, WifiOff, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

interface AuditEntry {
  id: string;
  user: string;
  email: string;
  labName: string;
  protocol: string;
  region: string;
  vmSize: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  status: string;
  connectionQuality: string;
  idleMinutes: number;
  disconnects: number;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-success/10 text-success" },
  active: { label: "Active", className: "bg-primary/10 text-primary" },
  terminated: { label: "Terminated", className: "bg-warning/10 text-warning" },
  error: { label: "Error", className: "bg-destructive/10 text-destructive" },
};

const qualityConfig: Record<string, { label: string; className: string; icon: typeof Wifi }> = {
  excellent: { label: "Excellent", className: "text-success", icon: Wifi },
  good: { label: "Good", className: "text-primary", icon: Wifi },
  fair: { label: "Fair", className: "text-warning", icon: Wifi },
  poor: { label: "Poor", className: "text-destructive", icon: WifiOff },
};

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function computeDuration(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.round((end - start) / 60000);
}

export default function SessionAuditLog() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [qualityFilter, setQualityFilter] = useState<string>("all");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async (): Promise<AuditEntry[]> => {
      // Fetch sessions with joined VM and lab template data
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select(`
          id,
          user_id,
          started_at,
          ended_at,
          region,
          idle_minutes,
          status,
          connection_quality,
          disconnects,
          lab_template_id,
          virtual_machines (
            vm_size
          )
        `)
        .order("started_at", { ascending: false });

      if (error) throw error;
      if (!sessions || sessions.length === 0) return [];

      // Fetch profiles and lab templates in parallel
      const userIds = [...new Set(sessions.map((s) => s.user_id).filter(Boolean))] as string[];
      const labIds = [...new Set(sessions.map((s) => s.lab_template_id).filter(Boolean))] as string[];

      const [profilesRes, labsRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from("profiles").select("user_id, display_name, email").in("user_id", userIds)
          : { data: [], error: null },
        labIds.length > 0
          ? supabase.from("lab_templates").select("id, name, protocol").in("id", labIds)
          : { data: [], error: null },
      ]);

      const profileMap = new Map(
        (profilesRes.data || []).map((p) => [p.user_id, p])
      );
      const labMap = new Map(
        (labsRes.data || []).map((l) => [l.id, l])
      );

      return sessions.map((s) => {
        const profile = profileMap.get(s.user_id ?? "");
        const lab = labMap.get(s.lab_template_id ?? "");
        const vm = Array.isArray(s.virtual_machines) ? s.virtual_machines[0] : s.virtual_machines;

        return {
          id: s.id,
          user: profile?.display_name || "Unknown User",
          email: profile?.email || "",
          labName: lab?.name || "Unknown Lab",
          protocol: lab?.protocol || "RDP",
          region: s.region,
          vmSize: vm?.vm_size || "N/A",
          startedAt: s.started_at,
          endedAt: s.ended_at,
          durationMinutes: computeDuration(s.started_at, s.ended_at),
          status: s.status || "active",
          connectionQuality: s.connection_quality || "good",
          idleMinutes: s.idle_minutes,
          disconnects: s.disconnects ?? 0,
        };
      });
    },
  });

  const filtered = entries.filter((e) => {
    const matchesSearch =
      !search ||
      e.user.toLowerCase().includes(search.toLowerCase()) ||
      e.labName.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesQuality = qualityFilter === "all" || e.connectionQuality === qualityFilter;
    return matchesSearch && matchesStatus && matchesQuality;
  });

  const totalSessions = entries.length;
  const avgDuration = totalSessions > 0 ? Math.round(entries.reduce((s, e) => s + e.durationMinutes, 0) / totalSessions) : 0;
  const goodQualityCount = entries.filter((e) => e.connectionQuality === "excellent" || e.connectionQuality === "good").length;
  const issueCount = entries.filter((e) => e.status === "error" || e.status === "terminated").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Session Audit Log</h1>
            <p className="text-sm text-muted-foreground mt-1">Track lab session history, duration, and connection quality</p>
          </div>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Sessions", value: isLoading ? "—" : totalSessions, sub: "all time" },
            { label: "Avg Duration", value: isLoading ? "—" : formatDuration(avgDuration), sub: "per session" },
            { label: "Good Quality", value: isLoading ? "—" : totalSessions > 0 ? `${Math.round((goodQualityCount / totalSessions) * 100)}%` : "0%", sub: `${goodQualityCount}/${totalSessions} sessions` },
            { label: "Issues", value: isLoading ? "—" : issueCount, sub: "errors & terminations" },
          ].map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{card.label}</p>
              <p className="text-2xl font-semibold font-mono text-foreground mt-1">{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by user, email, or lab..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={qualityFilter} onValueChange={setQualityFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Quality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Quality</SelectItem>
              <SelectItem value="excellent">Excellent</SelectItem>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="fair">Fair</SelectItem>
              <SelectItem value="poor">Poor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Audit Table */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Lab</TableHead>
                <TableHead className="text-xs">Started</TableHead>
                <TableHead className="text-xs">Duration</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Quality</TableHead>
                <TableHead className="text-xs text-right">Idle</TableHead>
                <TableHead className="text-xs text-right">Disconnects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    {entries.length === 0 ? "No sessions recorded yet." : "No sessions match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((entry) => {
                  const quality = qualityConfig[entry.connectionQuality] || qualityConfig.good;
                  const status = statusConfig[entry.status] || statusConfig.active;
                  const QualityIcon = quality.icon;
                  return (
                    <TableRow key={entry.id} className="group">
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium text-foreground">{entry.user}</p>
                          <p className="text-[10px] text-muted-foreground">{entry.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {entry.protocol === "RDP" ? <Monitor className="h-3.5 w-3.5 text-primary" /> : <Terminal className="h-3.5 w-3.5 text-success" />}
                          <span className="text-sm text-foreground">{entry.labName}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{entry.region} · {entry.vmSize}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(entry.startedAt)}</TableCell>
                      <TableCell className="text-sm font-mono text-foreground">{formatDuration(entry.durationMinutes)}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", status.className)}>
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <QualityIcon className={cn("h-3.5 w-3.5", quality.className)} />
                          <span className={cn("text-xs", quality.className)}>{quality.label}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono text-muted-foreground">{entry.idleMinutes}m</TableCell>
                      <TableCell className="text-right text-sm font-mono text-muted-foreground">{entry.disconnects}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
