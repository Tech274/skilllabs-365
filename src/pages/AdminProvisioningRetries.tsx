import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Unlock } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface RetryRow {
  id: string;
  idempotency_key: string;
  action: string;
  status: string;
  correlation_id: string | null;
  user_id: string;
  vm_id: string | null;
  attempts: number;
  last_error: string | null;
  actor_type: string;
  last_retried_at: string | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_VARIANT: Record<string, string> = {
  completed: "bg-primary/15 text-primary border-primary/30",
  in_progress: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

type Filter = "all" | "in_progress" | "completed";

export default function AdminProvisioningRetries() {
  const [rows, setRows] = useState<RetryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<{ row: RetryRow; mode: "retry" | "reset" } | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("provisioning_idempotency")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as RetryRow[]);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const runAction = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("provisioning-retry", {
        body: { record_id: pending.row.id, mode: pending.mode },
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; message?: string };
      if (result?.success === false) throw new Error(result.error ?? "Retry failed");
      toast({
        title: pending.mode === "retry" ? "Retry executed" : "Claim released",
        description: result?.message ?? "The action was replayed idempotently and recorded in the audit timeline.",
      });
      setPending(null);
      load();
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Could not run the retry.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const stale = (r: RetryRow) =>
    r.status !== "completed" && Date.now() - new Date(r.created_at).getTime() > 10 * 60 * 1000;

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Provisioning Retries</h1>
            <p className="text-sm text-muted-foreground">
              Every provisioning and cancellation attempt tracked by its idempotency key, with status, error and manual
              idempotent retry controls.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="in_progress">In progress</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Attempts {rows ? <span className="font-normal text-muted-foreground">({rows.length})</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && !rows ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !rows?.length ? (
              <EmptyState
                icon={RotateCcw}
                title="No provisioning attempts"
                description="Attempts appear here as soon as labs are provisioned or cancelled."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Attributed</TableHead>
                      <TableHead>Idempotency key</TableHead>
                      <TableHead>Last error</TableHead>
                      <TableHead className="text-right">Controls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                          {stale(r) && (
                            <span className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                              <AlertTriangle className="h-3 w-3" /> stuck
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.action}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_VARIANT[r.status] ?? ""}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{r.attempts ?? 1}</TableCell>
                        <TableCell className="text-xs capitalize">{r.actor_type ?? "user"}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                          {r.idempotency_key}
                        </TableCell>
                        <TableCell className="max-w-xs text-xs text-destructive">{r.last_error ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setPending({ row: r, mode: "retry" })}>
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPending({ row: r, mode: "reset" })}>
                              <Unlock className="mr-1.5 h-3.5 w-3.5" /> Release
                            </Button>
                          </div>
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

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === "retry" ? "Retry idempotently?" : "Release this claim?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.mode === "retry"
                ? `The ${pending?.row.action} action will be replayed using the same idempotency key and attributed to you in the audit timeline. Completed work is never duplicated.`
                : `The stuck claim for ${pending?.row.action} will be released so the owning user's next attempt can execute. This is recorded in the audit timeline.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); runAction(); }} disabled={working}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {pending?.mode === "retry" ? "Run retry" : "Release"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
