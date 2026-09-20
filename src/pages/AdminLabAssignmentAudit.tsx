import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ClipboardList, Download, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

type AuditRow = {
  id: string;
  lab_template_id: string;
  student_id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
};

const ALL = "__all__";

export default function AdminLabAssignmentAudit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [labNames, setLabNames] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(ALL);
  const [lab, setLab] = useState(ALL);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("student_lab_assignment_audit")
      .select("id, lab_template_id, student_id, action, actor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const list = (data ?? []) as AuditRow[];
    setRows(list);

    const labIds = Array.from(new Set(list.map(r => r.lab_template_id)));
    const userIds = Array.from(new Set(list.flatMap(r => [r.student_id, r.actor_id].filter(Boolean) as string[])));

    const [labRes, profileRes] = await Promise.all([
      labIds.length ? supabase.from("lab_templates").select("id, name").in("id", labIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      userIds.length ? supabase.from("profiles").select("user_id, display_name, email").in("user_id", userIds) : Promise.resolve({ data: [] as { user_id: string; display_name: string; email: string | null }[] }),
    ]);
    setLabNames(Object.fromEntries((labRes.data ?? []).map(l => [l.id, l.name])));
    setPeople(Object.fromEntries((profileRes.data ?? []).map(p => [p.user_id, p.display_name || p.email || p.user_id])));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (action !== ALL && r.action !== action) return false;
      if (lab !== ALL && r.lab_template_id !== lab) return false;
      if (!q) return true;
      const hay = [labNames[r.lab_template_id], people[r.student_id], r.actor_id ? people[r.actor_id] : "", r.action]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, action, lab, search, labNames, people]);

  const labOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.lab_template_id))).map(id => ({ id, name: labNames[id] ?? id })),
    [rows, labNames],
  );

  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Timestamp", "Action", "Lab", "Student", "Actor"].join(","),
      ...filtered.map(r => [
        new Date(r.created_at).toISOString(),
        r.action,
        labNames[r.lab_template_id] ?? r.lab_template_id,
        people[r.student_id] ?? r.student_id,
        r.actor_id ? (people[r.actor_id] ?? r.actor_id) : "system",
      ].map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-assignment-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-[1600px] mx-auto w-full">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Platform Admin</p>
            <h1 className="text-2xl font-semibold text-foreground">Lab Assignment Audit</h1>
            <p className="text-sm text-muted-foreground mt-1">Who assigned or revoked each student lab assignment, and when.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
            <Button size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
          </div>
        </header>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Search lab, student, or actor" value={search} onChange={e => setSearch(e.target.value)} className="sm:max-w-xs" />
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lab} onValueChange={setLab}>
            <SelectTrigger className="sm:w-64"><SelectValue placeholder="Lab" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All labs</SelectItem>
              {labOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No assignment activity"
            description="Assignment and revocation events will appear here once labs are assigned to students."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">When</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Action</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Lab</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Student</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-3 text-muted-foreground font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={cn(
                            "text-[10px] capitalize",
                            r.action === "assigned" ? "text-success border-success/30" :
                            r.action === "revoked" ? "text-destructive border-destructive/30" :
                            "text-muted-foreground",
                          )}>{r.action}</Badge>
                        </td>
                        <td className="p-3 text-foreground">{labNames[r.lab_template_id] ?? r.lab_template_id}</td>
                        <td className="p-3 text-foreground">{people[r.student_id] ?? r.student_id}</td>
                        <td className="p-3 text-muted-foreground">{r.actor_id ? (people[r.actor_id] ?? r.actor_id) : "system"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
