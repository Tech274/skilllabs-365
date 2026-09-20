import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Check, ClipboardList, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterAccessRequests, REQUEST_STATUSES, RESOURCE_LABEL, STATUS_VARIANT,
  type AccessRequestRow, type AccessRequestStatus, type AccessResourceType,
} from "@/lib/access-requests";

export default function AccessRequests() {
  const [rows, setRows] = useState<AccessRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AccessRequestStatus | "all">("pending");
  const [resourceType, setResourceType] = useState<AccessResourceType | "all">("all");
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<{ row: AccessRequestRow; decision: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("access-requests", { body: { action: "list" } });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load access requests", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data?.requests ?? []) as AccessRequestRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => filterAccessRequests(rows, { status, resourceType, search }),
    [rows, status, resourceType, search],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of REQUEST_STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const submitReview = async () => {
    if (!review) return;
    setSaving(true);
    const { error } = await supabase.functions.invoke("access-requests", {
      body: { action: "review", request_id: review.row.id, decision: review.decision, note: note || null },
    });
    setSaving(false);
    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: review.decision === "approved" ? "Request approved" : "Request rejected",
      description: review.decision === "approved"
        ? "Access has been granted and the learner was notified."
        : "The learner was notified.",
    });
    setReview(null);
    setNote("");
    void load();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Access Requests</h1>
            <p className="text-sm text-muted-foreground">
              Review learner requests for VM labs and cloud access templates. Approving a request grants the entitlement immediately.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </motion.div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={status} onValueChange={(v) => setStatus(v as AccessRequestStatus | "all")}>
              <TabsList>
                <TabsTrigger value="pending">Pending ({counts.pending ?? 0})</TabsTrigger>
                <TabsTrigger value="approved">Approved ({counts.approved ?? 0})</TabsTrigger>
                <TabsTrigger value="rejected">Rejected ({counts.rejected ?? 0})</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled ({counts.cancelled ?? 0})</TabsTrigger>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Search requester or resource…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={resourceType} onValueChange={(v) => setResourceType(v as AccessResourceType | "all")}>
                <SelectTrigger className="sm:w-52"><SelectValue placeholder="Resource type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All resource types</SelectItem>
                  <SelectItem value="vm_lab">VM Lab</SelectItem>
                  <SelectItem value="cloud_access">Cloud Access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No access requests"
                description="Nothing matches the current filters. Learners can raise a request from their dashboard or the cloud access page."
              />
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requested</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Reviewer</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium text-foreground">{r.requester_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.requester_email ?? r.requester_id}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="text-foreground">{r.resource_name ?? r.resource_id}</div>
                          {r.resource_provider && (
                            <div className="text-xs text-muted-foreground uppercase">{r.resource_provider}</div>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="secondary">{RESOURCE_LABEL[r.resource_type]}</Badge></TableCell>
                        <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
                        <TableCell className="max-w-[16rem] text-xs text-muted-foreground truncate" title={r.reason ?? ""}>
                          {r.reason ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.reviewer_email ?? (r.reviewer_id ? r.reviewer_id : "—")}
                          {r.review_note && <div className="italic">{r.review_note}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === "pending" && r.can_review ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" className="gap-1" onClick={() => { setReview({ row: r, decision: "approved" }); setNote(""); }}>
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => { setReview({ row: r, decision: "rejected" }); setNote(""); }}>
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          ) : r.status === "pending" ? (
                            <span className="text-xs text-muted-foreground">Admin review required</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{review?.decision === "approved" ? "Approve access request" : "Reject access request"}</DialogTitle>
            <DialogDescription>
              {review?.decision === "approved"
                ? `This grants ${review?.row.requester_email ?? "the learner"} access to "${review?.row.resource_name ?? "this resource"}" straight away.`
                : "The learner is notified and can raise a new request later."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Optional note for the learner and the audit log"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void submitReview()} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {review?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
