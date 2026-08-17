import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, FileJson, FileSpreadsheet, Loader2, Search, ShieldCheck } from "lucide-react";
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
  created_at: string;
  correlation_id: string;
  source: string;
  step: string;
  status: string;
  message: string | null;
  duration_ms: number | null;
  vm_id: string | null;
  session_id: string | null;
  lab_template_id: string | null;
  user_id: string | null;
  idempotency_key: string;
  idempotency_status: string;
  cancellation_outcome: string;
  attributed_to: string;
  actor_type: string;
  attempts: number | string;
  last_error: string;
  detail: unknown;
}

const STATUS_VARIANT: Record<string, string> = {
  success: "bg-primary/15 text-primary border-primary/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  running: "bg-muted text-muted-foreground border-border",
  skipped: "bg-muted text-muted-foreground border-border",
};

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
  const [downloading, setDownloading] = useState<"json" | "csv" | null>(null);
  const [rows, setRows] = useState<EventRow[] | null>(null);

  const filters = useMemo(
    () => ({
      correlation_id: correlationId.trim() || undefined,
      vm_id: vmId.trim() || undefined,
      session_id: sessionId.trim() || undefined,
    }),
    [correlationId, vmId, sessionId],
  );

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("provisioning-export", {
        body: { ...filters, format: "json" },
      });
      if (error) throw error;
      setRows(((data as { rows?: EventRow[] })?.rows ?? []) as EventRow[]);
    } catch (e) {
      toast({
        title: "Search failed",
        description: e instanceof Error ? e.message : "Could not load provisioning events.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const stamp = useMemo(() => new Date().toISOString().replace(/[:.]/g, "-"), []);
  const slug = correlationId.trim() || vmId.trim() || sessionId.trim() || "all";

  const runExport = async (format: "json" | "csv") => {
    setDownloading(format);
    try {
      const { data, error } = await supabase.functions.invoke("provisioning-export", {
        body: { ...filters, format },
      });
      if (error) throw error;
      if (format === "csv") {
        const text = typeof data === "string" ? data : await (data as Blob).text();
        download(`provisioning-${slug}-${stamp}.csv`, text, "text/csv");
      } else {
        const payload = data as { rows?: EventRow[] };
        download(
          `provisioning-${slug}-${stamp}.json`,
          JSON.stringify(payload?.rows ?? [], null, 2),
          "application/json",
        );
      }
      toast({ title: "Export downloaded", description: "This download has been recorded in the export audit log." });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not generate the export.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provisioning Export</h1>
          <p className="text-sm text-muted-foreground">
            Pull the full audit timeline for an incident — including idempotency key, cancellation outcome and operator
            or watchdog attribution — then download it as JSON or CSV.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
          <span>
            Restricted to admins and instructors. Authorization is enforced server-side and every download is written to
            the export audit log with the requester, filters and row count.
          </span>
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
              <Button variant="outline" onClick={() => runExport("json")} disabled={downloading !== null}>
                {downloading === "json" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileJson className="mr-2 h-4 w-4" />}
                Download JSON
              </Button>
              <Button variant="outline" onClick={() => runExport("csv")} disabled={downloading !== null}>
                {downloading === "csv" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Download CSV
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
                      <TableHead>Cancellation</TableHead>
                      <TableHead>Attribution</TableHead>
                      <TableHead>Idempotency key</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={`${r.correlation_id}-${i}`}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{r.source}</TableCell>
                        <TableCell className="text-xs">{r.step}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_VARIANT[r.status] ?? ""}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{r.cancellation_outcome || "—"}</TableCell>
                        <TableCell className="text-xs">
                          <span className="capitalize">{r.actor_type || "user"}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {r.attributed_to || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {r.idempotency_key || "—"}
                        </TableCell>
                        <TableCell className="max-w-md text-xs">{r.message ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">
                          {r.duration_ms === null ? "—" : `${r.duration_ms} ms`}
                        </TableCell>
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
