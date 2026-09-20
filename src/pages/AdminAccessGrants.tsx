import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { Check, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { listAccessGrants, reviewGrant, type AccessGrantRow, type ApprovalStatus } from "@/lib/access-grants";

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  approved: "text-success border-success/30",
  pending: "text-warning border-warning/30",
  denied: "text-destructive border-destructive/30",
};

export default function AdminAccessGrants() {
  const [rows, setRows] = useState<AccessGrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setRows(await listAccessGrants());
    } catch (err) {
      toast({
        title: "Could not load access grants",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const decide = async (row: AccessGrantRow, decision: "approved" | "denied") => {
    setBusyId(row.id);
    try {
      await reviewGrant(row.id, decision);
      toast({
        title: decision === "approved" ? "Access approved" : "Access denied",
        description: row.email ?? row.user_id,
      });
      await load();
    } catch (err) {
      toast({
        title: "Could not update access",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      !term
        ? rows
        : rows.filter((r) =>
            [r.email, r.display_name, r.certification_slug, r.plan_key, r.source]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(term)),
          ),
    [rows, term],
  );

  const tiles = [
    { label: "Approved", value: rows.filter((r) => r.approval_status === "approved" && r.active).length },
    { label: "Pending", value: rows.filter((r) => r.approval_status === "pending").length },
    { label: "Denied", value: rows.filter((r) => r.approval_status === "denied").length },
    { label: "From partner", value: rows.filter((r) => r.source === "skilltrack").length },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Learner Lab Access
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Approve or deny each learner's lab access grant
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <Card key={t.label}>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-foreground">{t.value}</p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Input
          placeholder="Search learner, certification or SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No access grants yet"
            description="Learners arriving through partner links are granted access automatically and will appear here."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="text-left p-3">Learner</th>
                      <th className="text-left p-3">Certification</th>
                      <th className="text-left p-3">SKU / plan</th>
                      <th className="text-left p-3">Source</th>
                      <th className="text-center p-3">Status</th>
                      <th className="text-left p-3">Requested</th>
                      <th className="text-right p-3">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3">
                          <p className="text-foreground">{r.email || r.display_name || "—"}</p>
                          {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                        </td>
                        <td className="p-3 text-muted-foreground">{r.certification_slug || "—"}</td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">{r.plan_key || "—"}</td>
                        <td className="p-3 text-muted-foreground">{r.source}</td>
                        <td className="text-center p-3">
                          <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[r.approval_status] ?? ""}`}>
                            {r.approval_status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={busyId === r.id || (r.approval_status === "approved" && r.active)}
                              onClick={() => decide(r, "approved")}
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-destructive"
                              disabled={busyId === r.id || r.approval_status === "denied"}
                              onClick={() => decide(r, "denied")}
                            >
                              <X className="h-3.5 w-3.5" /> Deny
                            </Button>
                          </div>
                        </td>
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
