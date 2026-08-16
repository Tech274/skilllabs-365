import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Scope = "user" | "org" | "global";

type QuotaRow = {
  id: string;
  scope: Scope;
  scope_id: string | null;
  per_minute_limit: number;
  daily_limit: number;
  active: boolean;
  note: string | null;
};

export function AiQuotaManager() {
  const [rows, setRows] = useState<QuotaRow[]>([]);
  const [users, setUsers] = useState<{ user_id: string; display_name: string }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [scope, setScope] = useState<Scope>("user");
  const [scopeId, setScopeId] = useState<string>("");
  const [perMinute, setPerMinute] = useState("10");
  const [daily, setDaily] = useState("200");

  const load = useCallback(async () => {
    setLoading(true);
    const [quotas, profiles, organizations] = await Promise.all([
      supabase.from("ai_usage_quotas").select("*").order("scope"),
      supabase.from("profiles").select("user_id, display_name").order("display_name").limit(200),
      supabase.from("organizations").select("id, name").order("name").limit(200),
    ]);
    setRows((quotas.data ?? []) as QuotaRow[]);
    setUsers((profiles.data ?? []) as { user_id: string; display_name: string }[]);
    setOrgs((organizations.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const label = (row: QuotaRow) => {
    if (row.scope === "global") return "All users (platform-wide)";
    if (row.scope === "org") return orgs.find((o) => o.id === row.scope_id)?.name ?? "Organization";
    return users.find((u) => u.user_id === row.scope_id)?.display_name ?? "User";
  };

  const save = async () => {
    if (scope !== "global" && !scopeId) {
      toast({ title: "Select a target", description: `Choose a ${scope} to apply the quota to.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("ai_usage_quotas").upsert(
      {
        scope,
        scope_id: scope === "global" ? null : scopeId,
        per_minute_limit: Number(perMinute) || 0,
        daily_limit: Number(daily) || 0,
        active: true,
      },
      { onConflict: "scope,scope_id" },
    );
    setSaving(false);
    if (error) {
      // Fall back to update when the unique index uses COALESCE semantics.
      const existing = rows.find(
        (r) => r.scope === scope && (r.scope_id ?? "") === (scope === "global" ? "" : scopeId),
      );
      if (existing) {
        const { error: updateError } = await supabase
          .from("ai_usage_quotas")
          .update({
            per_minute_limit: Number(perMinute) || 0,
            daily_limit: Number(daily) || 0,
            active: true,
          })
          .eq("id", existing.id);
        if (!updateError) {
          toast({ title: "Quota updated" });
          setScopeId("");
          load();
          return;
        }
      }
      toast({ title: "Could not save quota", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Quota saved" });
    setScopeId("");
    load();
  };

  const toggleActive = async (row: QuotaRow, active: boolean) => {
    const { error } = await supabase.from("ai_usage_quotas").update({ active }).eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active } : r)));
  };

  const remove = async (row: QuotaRow) => {
    const { error } = await supabase.from("ai_usage_quotas").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI usage quotas</CardTitle>
        <CardDescription>
          Rate limits and daily caps enforced before any provider call. Users without an explicit
          quota fall back to 10 requests/minute and 200 requests/day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-5 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Scope</Label>
            <Select value={scope} onValueChange={(v) => { setScope(v as Scope); setScopeId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="org">Organization</SelectItem>
                <SelectItem value="global">Platform-wide</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Target</Label>
            {scope === "global" ? (
              <Input value="All users" disabled />
            ) : (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger>
                  <SelectValue placeholder={scope === "org" ? "Select organization" : "Select user"} />
                </SelectTrigger>
                <SelectContent>
                  {(scope === "org"
                    ? orgs.map((o) => ({ value: o.id, label: o.name }))
                    : users.map((u) => ({ value: u.user_id, label: u.display_name }))
                  ).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Per minute</Label>
            <Input type="number" min={0} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Per day</Label>
            <Input type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} />
          </div>
          <div className="sm:col-span-5">
            <Button onClick={save} disabled={saving} size="sm" className="gap-2">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save quota
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No custom quotas configured"
            description="Default limits apply to every user until you add a quota."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Per minute</TableHead>
                  <TableHead>Per day</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="outline">{row.scope}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{label(row)}</TableCell>
                    <TableCell className="text-xs">{row.per_minute_limit || "unlimited"}</TableCell>
                    <TableCell className="text-xs">{row.daily_limit || "unlimited"}</TableCell>
                    <TableCell>
                      <Switch checked={row.active} onCheckedChange={(v) => toggleActive(row, v)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => remove(row)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
