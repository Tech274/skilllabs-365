import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { History, Monitor, Terminal, Clock, Wifi, WifiOff, AlertTriangle, Search, Filter, Download, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  user: string;
  email: string;
  labName: string;
  protocol: "RDP" | "SSH";
  region: string;
  vmSize: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  status: "completed" | "active" | "terminated" | "error";
  connectionQuality: "excellent" | "good" | "fair" | "poor";
  idleMinutes: number;
  disconnects: number;
}

const mockAuditData: AuditEntry[] = [
  { id: "s-001", user: "Alice Chen", email: "alice@university.edu", labName: "Azure Fundamentals", protocol: "RDP", region: "East US", vmSize: "Standard_B2s", startedAt: "2026-03-11T08:15:00Z", endedAt: "2026-03-11T10:12:00Z", durationMinutes: 117, status: "completed", connectionQuality: "excellent", idleMinutes: 4, disconnects: 0 },
  { id: "s-002", user: "Bob Patel", email: "bob@university.edu", labName: "Kubernetes Lab", protocol: "SSH", region: "Central India", vmSize: "Standard_B2ms", startedAt: "2026-03-11T09:00:00Z", endedAt: null, durationMinutes: 145, status: "active", connectionQuality: "good", idleMinutes: 8, disconnects: 1 },
  { id: "s-003", user: "Clara Diaz", email: "clara@university.edu", labName: "DevOps Pipeline", protocol: "SSH", region: "East US", vmSize: "Standard_B4ms", startedAt: "2026-03-10T14:30:00Z", endedAt: "2026-03-10T18:20:00Z", durationMinutes: 230, status: "completed", connectionQuality: "good", idleMinutes: 12, disconnects: 0 },
  { id: "s-004", user: "David Kim", email: "david@university.edu", labName: "Security Workshop", protocol: "RDP", region: "East US", vmSize: "Standard_D2s_v3", startedAt: "2026-03-10T10:00:00Z", endedAt: "2026-03-10T10:35:00Z", durationMinutes: 35, status: "terminated", connectionQuality: "poor", idleMinutes: 20, disconnects: 4 },
  { id: "s-005", user: "Elena Volkov", email: "elena@university.edu", labName: "Azure Fundamentals", protocol: "RDP", region: "East US", vmSize: "Standard_B2s", startedAt: "2026-03-10T08:00:00Z", endedAt: "2026-03-10T10:05:00Z", durationMinutes: 125, status: "completed", connectionQuality: "excellent", idleMinutes: 2, disconnects: 0 },
  { id: "s-006", user: "Farhan Ali", email: "farhan@university.edu", labName: "Linux Administration", protocol: "SSH", region: "Central India", vmSize: "Standard_B2s", startedAt: "2026-03-09T13:00:00Z", endedAt: "2026-03-09T13:08:00Z", durationMinutes: 8, status: "error", connectionQuality: "poor", idleMinutes: 0, disconnects: 3 },
  { id: "s-007", user: "Grace Liu", email: "grace@university.edu", labName: "Kubernetes Lab", protocol: "SSH", region: "East US", vmSize: "Standard_B2ms", startedAt: "2026-03-09T09:30:00Z", endedAt: "2026-03-09T12:28:00Z", durationMinutes: 178, status: "completed", connectionQuality: "fair", idleMinutes: 18, disconnects: 2 },
  { id: "s-008", user: "Hiro Tanaka", email: "hiro@university.edu", labName: "DevOps Pipeline", protocol: "SSH", region: "East US", vmSize: "Standard_B4ms", startedAt: "2026-03-09T07:00:00Z", endedAt: "2026-03-09T11:00:00Z", durationMinutes: 240, status: "completed", connectionQuality: "excellent", idleMinutes: 5, disconnects: 0 },
];

const statusConfig: Record<AuditEntry["status"], { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-success/10 text-success" },
  active: { label: "Active", className: "bg-primary/10 text-primary" },
  terminated: { label: "Terminated", className: "bg-warning/10 text-warning" },
  error: { label: "Error", className: "bg-destructive/10 text-destructive" },
};

const qualityConfig: Record<AuditEntry["connectionQuality"], { label: string; className: string; icon: typeof Wifi }> = {
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

export default function SessionAuditLog() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [qualityFilter, setQualityFilter] = useState<string>("all");

  const filtered = mockAuditData.filter((e) => {
    const matchesSearch = !search || e.user.toLowerCase().includes(search.toLowerCase()) || e.labName.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesQuality = qualityFilter === "all" || e.connectionQuality === qualityFilter;
    return matchesSearch && matchesStatus && matchesQuality;
  });

  const totalSessions = mockAuditData.length;
  const avgDuration = Math.round(mockAuditData.reduce((s, e) => s + e.durationMinutes, 0) / totalSessions);
  const avgQuality = mockAuditData.filter((e) => e.connectionQuality === "excellent" || e.connectionQuality === "good").length;
  const errorRate = mockAuditData.filter((e) => e.status === "error" || e.status === "terminated").length;

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
            { label: "Total Sessions", value: totalSessions, sub: "last 7 days" },
            { label: "Avg Duration", value: formatDuration(avgDuration), sub: "per session" },
            { label: "Good Quality", value: `${Math.round((avgQuality / totalSessions) * 100)}%`, sub: `${avgQuality}/${totalSessions} sessions` },
            { label: "Issues", value: errorRate, sub: "errors & terminations" },
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
              {filtered.map((entry) => {
                const quality = qualityConfig[entry.connectionQuality];
                const status = statusConfig[entry.status];
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
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    No sessions match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
