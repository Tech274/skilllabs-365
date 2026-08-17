import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, FileJson, FileSpreadsheet, Loader2, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface EventRow {
  id: string;
  created_at: string;
  correlation_id: string;
  user_id: string | null;
  vm_id: string | null;
  session_id: string | null;
  lab_template_id: string | null;
  source: string;
  step: string;
  status: string;
  message: string | null;
  duration_ms: number | null;
  detail: unknown;
}

const STATUS_VARIANT: Record<string, string> = {
  success: "bg-primary/15 text-primary border-primary/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  running: "bg-muted text-muted-foreground border-border",
  skipped: "bg-muted text-muted-foreground border-border",
};

function toCsv(rows: EventRow[]): string {
  const headers = [
    "created_at", "correlation_id", "source", "step", "status", "message",
    "duration_ms", "vm_id", "session_id", "lab_template_id", "user_id", "detail",
  ];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(",")),
  ].join("\n");
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminProvisioningExport() {
  const [correlationId, setCorrelationId] = useState("");
  const [vmId, setVmId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EventRow[] | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("provisioning_events")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(2000);

      if (correlationId.trim()) query = query.eq("correlation_id", correlationId.trim());
      if (vmId.trim()) query = query.eq("vm_id", vmId.trim());
      if (sessionId.trim()) query = query.eq("session_id", sessionId.trim());

      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as EventRow[]);
    } catch (e) {
      toast({
        title: "Search failed",
        description: e instanceof Error ? e.message : "Could not load provisioning events.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [correlationId, vmId, sessionId]);

  const stamp = useMemo(() => new Date().toISOString().replace(/[:.]/g, "-"), []);
  const slug = correlationId.trim() || vmId.trim() || sessionId.trim() || "all";

  const exportJson = () => {
    if (!rows?.length) return;
    download(`provisioning-${slug}-${stamp}.json`, JSON.stringify(rows, null, 2), "application/json");
  };
  const exportCsv = () => {
    if (!rows?.length) return;
    download(`provisioning-${slug}-${stamp}.csv`, toCsv(rows), "text/csv");
  };

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provisioning Export</h1>
          <p className="text-sm text-muted-foreground">
            Pull the full audit timeline for an incident by correlation request ID, lab VM or session, then download it as JSON or CSV.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cid">Correlation request ID</Label>
                <Input id="cid" placeholder="prv_…" value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vm">Lab VM ID</Label>
                <Input id="vm" placeholder="uuid" value={vmId} onChange={(e) => setVmId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sid">Session ID</Label>
                <Input id="sid" placeholder="uuid" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={runSearch} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Search events
              </Button>
              <Button variant="outline" onClick={exportJson} disabled={!rows?.length}>
                <FileJson className="mr-2 h-4 w-4" /> Download JSON
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Download CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Results {rows ? <span className="text-muted-foreground font-normal">({rows.length})</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!rows ? (
              <EmptyState
                icon={Download}
                title="No search yet"
                description="Enter a correlation ID, VM or session to load its provisioning timeline."
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No matching events"
                description="Nothing was recorded for these filters. Double-check the identifier."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>Correlation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{r.source}</TableCell>
                        <TableCell className="text-xs">{r.step}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_VARIANT[r.status] ?? ""}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md text-xs">{r.message ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">
                          {r.duration_ms === null ? "—" : `${r.duration_ms} ms`}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{r.correlation_id}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
}
