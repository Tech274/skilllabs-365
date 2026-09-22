import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Workspace } from "@/components/WorkspaceLauncher";

type Learner = { user_id: string; display_name: string; email: string | null };

/**
 * Admin dialog that maps learners onto a workspace template. Workspaces are
 * hidden from /applications until a learner has an active assignment here.
 */
export function WorkspaceAssignmentDialog({ workspace, onOpenChange, onSaved }: {
  workspace: Workspace | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    const [{ data: profiles }, { data: rows }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, email").order("display_name"),
      supabase.from("workspace_assignments")
        .select("user_id")
        .eq("workspace_id", workspace.id)
        .is("revoked_at", null),
    ]);
    setLearners((profiles ?? []) as Learner[]);
    setAssigned(new Set((rows ?? []).map((r) => r.user_id)));
    setLoading(false);
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return learners;
    return learners.filter((l) =>
      l.display_name.toLowerCase().includes(term) || (l.email ?? "").toLowerCase().includes(term));
  }, [learners, search]);

  const toggle = async (learner: Learner, next: boolean) => {
    if (!workspace) return;
    setBusy(learner.user_id);
    const { error } = next
      ? await supabase.from("workspace_assignments").upsert({
          workspace_id: workspace.id,
          user_id: learner.user_id,
          assigned_by: user?.id ?? null,
          revoked_at: null,
        }, { onConflict: "workspace_id,user_id" })
      : await supabase.from("workspace_assignments")
          .update({ revoked_at: new Date().toISOString() })
          .eq("workspace_id", workspace.id)
          .eq("user_id", learner.user_id);
    setBusy(null);
    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
      return;
    }
    setAssigned((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(learner.user_id); else copy.delete(learner.user_id);
      return copy;
    });
    onSaved?.();
  };

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Assign learners — {workspace?.name}
          </DialogTitle>
          <DialogDescription>
            Only assigned learners can see and launch this workspace. Nothing is visible by default.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search learners by name or email"
            className="pl-8 h-9"
            aria-label="Search learners"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            {assigned.size} learner{assigned.size === 1 ? "" : "s"} assigned
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading learners…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No learners match your search.</p>
          ) : (
            filtered.map((l) => (
              <div key={l.user_id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">{l.display_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{l.email ?? "—"}</p>
                </div>
                {assigned.has(l.user_id) && (
                  <Badge variant="secondary" className="text-[10px]">Assigned</Badge>
                )}
                <Switch
                  checked={assigned.has(l.user_id)}
                  disabled={busy === l.user_id}
                  onCheckedChange={(v) => void toggle(l, v)}
                  aria-label={`Assign ${l.display_name} to ${workspace?.name ?? "workspace"}`}
                />
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
