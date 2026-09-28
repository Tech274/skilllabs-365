import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { ClipboardList, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface AuditRow {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_label: string | null;
  outcome: string;
  message: string | null;
  correlation_id: string | null;
  changes: Record<string, unknown> | null;
}

const OUTCOME_STYLES: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  blocked: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  already_running: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  already_starting: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  start_accepted: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  running: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

const OUTCOME_LABELS: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  blocked: "Blocked",
  already_running: "Already running",
  already_starting: "Already starting",
  start_accepted: "Start accepted",
  running: "Running",
};

function outcomeBadge(outcome: string): { label: string; className: string } {
  return {
    label: OUTCOME_LABELS[outcome] ?? outcome,
    className: OUTCOME_STYLES[outcome] ?? "",
  };
}

function toCsv(rows: AuditRow[]): string {
  const header = [
    "created_at", "actor_email", "actor_type", "action", "entity_type",
    "entity_label", "outcome", "message", "correlation_id", "changes",
  ];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    header.join(","),
    ...rows.map((r) => header.map((k) => escape(
      k === "changes" ? JSON.stringify(r.changes ?? {}) : (r as unknown as Record<string, unknown>)[k],
    )).join(",")),
  ].join("\n");
}

export default function AdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("admin_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (entityType !== "all") query = query.eq("entity_type", entityType);
    const { data } = await query;
    setRows((data ?? []) as unknown as AuditRow[]);
    setLoading(false);
  }, [entityType]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.actor_email, r.action, r.entity_label, r.message, r.correlation_id]
        .some((v) => v?.toLowerCase().includes(q)));
  }, [rows, search]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Admin Audit Log</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every resource provider change and lab launch outcome, with actor and timestamp.
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

        <div className="flex flex-col sm:flex-row gap-3">
          <Input placeholder="Search actor, entity, correlation id…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="cloud_provider_account">Resource providers</SelectItem>
              <SelectItem value="lab_template">Lab launches</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!loading && filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No audit entries"
            description="Admin changes and launch attempts will appear here as they happen." />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Actor</th>
                  <th className="text-left p-3">Action</th>
                  <th className="text-left p-3">Entity</th>
                  <th className="text-left p-3">Outcome</th>
                  <th className="text-left p-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const badge = outcomeBadge(r.outcome);
                  return (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.3) }}
                    className="border-b border-border/50 last:border-0 align-top"
                  >
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <div className="text-foreground">{r.actor_email ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.actor_type}</div>
                    </td>
                    <td className="p-3 font-mono text-xs">{r.action}</td>
                    <td className="p-3">
                      <div>{r.entity_label ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.entity_type}</div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                    </td>
                    <td className="p-3 max-w-md">
                      {r.message && <div className="text-xs text-muted-foreground">{r.message}</div>}
                      {r.changes && Object.keys(r.changes).length > 0 && (
                        <pre className="mt-1 text-[11px] text-muted-foreground/80 whitespace-pre-wrap break-all">
                          {JSON.stringify(r.changes, null, 1)}
                        </pre>
                      )}
                    </td>
                  </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
