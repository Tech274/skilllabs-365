import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Loader2, Plus, RefreshCw, Search, ShieldOff } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { listGrants, revokeGrant, upsertGrant } from "@/lib/manual-grants.functions";
import { cn } from "@/lib/utils";

type GrantRow = {
  id: string;
  user_id: string;
  certification_slug: string | null;
  note: string | null;
  ends_at: string | null;
  starts_at: string;
  active: boolean;
  created_at: string;
  granted_by: string | null;
};

type ProfileLite = {
  user_id: string;
  email: string | null;
  display_name: string | null;
};

const emptyForm = {
  email: "",
  certification_slug: "",
  note: "",
  ends_at: "",
  active: true,
};

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string | null {
  const t = local.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function AdminManualLabGrants() {
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [resolvedUser, setResolvedUser] = useState<ProfileLite | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await listGrants()) as GrantRow[];
      setGrants(rows);
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (userIds.length) {
        const { data } = await supabase
          .from("profiles")
          .select("user_id, email, display_name")
          .in("user_id", userIds);
        const map: Record<string, ProfileLite> = {};
        for (const p of data ?? []) {
          map[p.user_id] = p as ProfileLite;
        }
        setProfiles(map);
      } else {
        setProfiles({});
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load grants";
      toast({ title: "Failed to load Lab Grants", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grants;
    return grants.filter((g) => {
      const p = profiles[g.user_id];
      return [
        p?.email,
        p?.display_name,
        g.certification_slug,
        g.note,
        g.user_id,
      ].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [grants, profiles, search]);

  const openCreate = () => {
    setEditingId(null);
    setResolvedUser(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (g: GrantRow) => {
    const p = profiles[g.user_id];
    setEditingId(g.id);
    setResolvedUser(p ?? { user_id: g.user_id, email: null, display_name: null });
    setForm({
      email: p?.email ?? "",
      certification_slug: g.certification_slug ?? "",
      note: g.note ?? "",
      ends_at: toLocalInputValue(g.ends_at),
      active: g.active !== false,
    });
    setDialogOpen(true);
  };

  const lookupByEmail = async () => {
    const email = form.email.trim();
    if (!email) {
      toast({ title: "Email required", description: "Enter the learner email to look up.", variant: "destructive" });
      return;
    }
    setLookingUp(true);
    setResolvedUser(null);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, email, display_name")
        .ilike("email", email)
        .limit(5);
      if (error) throw error;
      const exact = (data ?? []).find((p) => (p.email || "").toLowerCase() === email.toLowerCase())
        ?? (data ?? [])[0]
        ?? null;
      if (!exact) {
        toast({
          title: "User not found",
          description: "No Hub profile matches that email. Ask the learner to sign in once first.",
          variant: "destructive",
        });
        return;
      }
      setResolvedUser(exact as ProfileLite);
      setForm((f) => ({ ...f, email: exact.email ?? email }));
      toast({ title: "User found", description: exact.display_name || exact.email || exact.user_id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Lookup failed";
      toast({ title: "Lookup failed", description: message, variant: "destructive" });
    } finally {
      setLookingUp(false);
    }
  };

  const saveGrant = async () => {
    if (!resolvedUser?.user_id) {
      toast({ title: "Look up a user first", description: "Resolve email → Hub user before granting.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await upsertGrant({
        id: editingId ?? undefined,
        user_id: resolvedUser.user_id,
        certification_slug: form.certification_slug.trim() || null,
        note: form.note.trim() || null,
        ends_at: fromLocalInputValue(form.ends_at),
        active: form.active,
      });
      toast({
        title: editingId ? "Grant updated" : "Lab grant created",
        description: "VM / lab unlocks use Admin → Lab Grants (not Cloud Access Catalogue).",
      });
      setDialogOpen(false);
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Failed to save grant", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeGrant(id);
      toast({ title: "Grant revoked", description: "Learner will need a new active Lab Grant to launch labs." });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Revoke failed";
      toast({ title: "Failed to revoke", description: message, variant: "destructive" });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-6 max-w-[1400px] mx-auto w-full">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Lab Grants</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manual VM / lab unlocks after payment (Ops). Separate from{" "}
              <span className="font-medium text-foreground">Cloud Access Catalogue</span>{" "}
              (console session templates).
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Grant by email
            </Button>
          </div>
        </header>

        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by email, cert slug, note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading grants…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={grants.length === 0 ? "No lab grants yet" : "No grants match your filter"}
            description={
              grants.length === 0
                ? "After SkillTrack payment, Ops grants Hub VM/lab access here by learner email."
                : "Try a different search."
            }
            hint={grants.length === 0 ? 'Click "Grant by email" to unlock a learner.' : undefined}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Learner</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Cert slug</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Note</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Ends</th>
                      <th className="text-center p-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-right p-3 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((g, i) => {
                      const p = profiles[g.user_id];
                      const expired = g.ends_at ? new Date(g.ends_at).getTime() < Date.now() : false;
                      return (
                        <motion.tr
                          key={g.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.02, 0.3) }}
                          className="border-b border-border/50 hover:bg-muted/20"
                        >
                          <td className="p-3">
                            <div className="font-medium text-foreground">{p?.display_name || "—"}</div>
                            <div className="text-xs text-muted-foreground font-mono">{p?.email || g.user_id}</div>
                          </td>
                          <td className="p-3 font-mono text-xs text-foreground">{g.certification_slug || "—"}</td>
                          <td className="p-3 text-muted-foreground max-w-[220px] truncate">{g.note || "—"}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {g.ends_at ? new Date(g.ends_at).toLocaleString() : "No end"}
                          </td>
                          <td className="p-3 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                g.active && !expired
                                  ? "text-success border-success/30"
                                  : "text-muted-foreground",
                              )}
                            >
                              {!g.active ? "revoked" : expired ? "expired" : "active"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right space-x-2 whitespace-nowrap">
                            <Button size="sm" variant="outline" onClick={() => openEdit(g)}>
                              Edit
                            </Button>
                            {g.active && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={revokingId === g.id}
                                onClick={() => void handleRevoke(g.id)}
                              >
                                {revokingId === g.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <><ShieldOff className="h-3.5 w-3.5 mr-1" /> Revoke</>
                                )}
                              </Button>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Lab Grant" : "Grant lab access by email"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="grant-email">Learner email</Label>
              <div className="flex gap-2">
                <Input
                  id="grant-email"
                  type="email"
                  placeholder="learner@example.com"
                  value={form.email}
                  disabled={!!editingId}
                  onChange={(e) => {
                    setResolvedUser(null);
                    setForm((f) => ({ ...f, email: e.target.value }));
                  }}
                />
                {!editingId && (
                  <Button type="button" variant="secondary" onClick={() => void lookupByEmail()} disabled={lookingUp}>
                    {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                  </Button>
                )}
              </div>
              {resolvedUser && (
                <p className="text-xs text-muted-foreground">
                  Matched: <span className="text-foreground">{resolvedUser.display_name || "—"}</span>
                  {" · "}
                  <span className="font-mono">{resolvedUser.email || resolvedUser.user_id}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-cert">Certification slug (optional)</Label>
              <Input
                id="grant-cert"
                placeholder="e.g. az-104"
                value={form.certification_slug}
                onChange={(e) => setForm((f) => ({ ...f, certification_slug: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Policy v1: any active grant unlocks published labs; cert-scoped matching comes later.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-note">Note</Label>
              <Textarea
                id="grant-note"
                placeholder="Invoice / payment reference…"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-ends">Ends at (optional)</Label>
              <Input
                id="grant-ends"
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label htmlFor="grant-active">Active</Label>
                <p className="text-[11px] text-muted-foreground">Inactive grants do not unlock lab provisioning.</p>
              </div>
              <Switch
                id="grant-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveGrant()} disabled={saving || !resolvedUser}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? "Save changes" : "Create grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
