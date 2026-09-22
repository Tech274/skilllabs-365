import { useEffect, useMemo, useState } from "react";
import { AppWindow, Download } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  filterLaunchRows, toLaunchCsv, type WorkspaceLaunchRow,
} from "@/lib/workspace-launches";

export default function AdminWorkspaceLaunches() {
  const [rows, setRows] = useState<WorkspaceLaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState("");
  const [workspace, setWorkspace] = useState("all");
  const [launchType, setLaunchType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("platform_application_launch_events")
        .select("id, created_at, user_id, workspace_id, workspace_name, launch_type, launch_url, generated_email")
        .order("created_at", { ascending: false })
        .limit(1000);
      const events = data ?? [];
      const ids = [...new Set(events.map((e) => e.user_id))];
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("user_id, email").in("user_id", ids)
        : { data: [] as Array<{ user_id: string; email: string | null }> };
      const emails = new Map((profiles ?? []).map((p) => [p.user_id, p.email]));
      setRows(events.map((e) => ({ ...e, user_email: emails.get(e.user_id) ?? null })));
      setLoading(false);
    })();
  }, []);

  const workspaces = useMemo(
    () => [...new Set(rows.map((r) => r.workspace_name))].sort(),
    [rows],
  );

  const filtered = useMemo(
    () => filterLaunchRows(rows, {
      user,
      workspace,
      launchType,
      from: from ? new Date(from) : null,
      to: to ? new Date(`${to}T23:59:59`) : null,
    }),
    [rows, user, workspace, launchType, from, to],
  );

  const exportCsv = () => {
    const blob = new Blob([toLaunchCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workspace-launches-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Workspace Launch Events</h1>
            <p className="text-sm text-muted-foreground">
              Launch-event audit — who opened a workspace, including generated trial emails.
              Catalog and learner assignment live under Applications. Admin only.
            </p>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>

        <Card className="rounded-md p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            value={user} onChange={(e) => setUser(e.target.value)}
            placeholder="Filter by user email or id" className="h-9" aria-label="Filter by user"
          />
          <Select value={workspace} onValueChange={setWorkspace}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Workspace" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w} value={w.toLowerCase()}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={launchType} onValueChange={setLaunchType}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Launch type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="trial_signup">Trial signup</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" aria-label="To date" />
        </Card>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading launch events…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No launch events"
            description="No workspace launches match the current filters."
          />
        ) : (
          <Card className="rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium p-2">Timestamp</th>
                  <th className="text-left font-medium p-2">User</th>
                  <th className="text-left font-medium p-2">Workspace</th>
                  <th className="text-left font-medium p-2">Type</th>
                  <th className="text-left font-medium p-2">Workspace email</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2">{r.user_email ?? r.user_id}</td>
                    <td className="p-2">{r.workspace_name}</td>
                    <td className="p-2">
                      <Badge variant={r.launch_type === "trial_signup" ? "secondary" : "outline"} className="text-[10px]">
                        {r.launch_type}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono">{r.generated_email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
