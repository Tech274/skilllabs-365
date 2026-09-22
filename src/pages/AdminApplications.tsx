import { useCallback, useEffect, useMemo, useState } from "react";
import { AppWindow, ExternalLink, Pencil, Plus, RotateCcw, Search, Trash2, Users } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/edge-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Workspace } from "@/components/WorkspaceLauncher";
import { WorkspaceAssignmentDialog } from "@/components/WorkspaceAssignmentDialog";
import {
  CATEGORY_COLORS, DEFAULT_LOGIN_BINDING_NOTE, DEFAULT_PASSWORD_PLACEHOLDER,
  DEFAULT_USERNAME_PLACEHOLDER, DEFAULT_WORKSPACE_CATALOG, DEFAULT_WORKSPACE_EMAIL_DOMAIN,
  WORKSPACE_CATEGORIES, iconLabel, slugify, workspaceIcon,
} from "@/lib/workspaces";

type Draft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon_label: string;
  icon_color: string;
  launch_url: string;
  status: string;
  access_note: string;
  workspace_email_enabled: boolean;
  trial_signup_url: string;
  username_placeholder: string;
  password_placeholder: string;
  login_binding_note: string;
};

const emptyDraft = (): Draft => ({
  name: "", slug: "", description: "", category: "Developer",
  icon_label: "WS", icon_color: CATEGORY_COLORS.Developer, launch_url: "",
  status: "active", access_note: "", workspace_email_enabled: false, trial_signup_url: "",
  username_placeholder: DEFAULT_USERNAME_PLACEHOLDER,
  password_placeholder: DEFAULT_PASSWORD_PLACEHOLDER,
  login_binding_note: DEFAULT_LOGIN_BINDING_NOTE,
});

const toDraft = (w: Workspace): Draft => ({
  id: w.id, name: w.name, slug: w.slug, description: w.description, category: w.category,
  icon_label: w.icon_label, icon_color: w.icon_color, launch_url: w.launch_url, status: w.status,
  access_note: w.access_note ?? "", workspace_email_enabled: w.workspace_email_enabled,
  trial_signup_url: w.trial_signup_url ?? "",
  username_placeholder: w.username_placeholder,
  password_placeholder: w.password_placeholder,
  login_binding_note: w.login_binding_note,
});

export default function AdminApplications() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Workspace | null>(null);
  const [assignCounts, setAssignCounts] = useState<Record<string, number>>({});
  const [domain, setDomain] = useState(DEFAULT_WORKSPACE_EMAIL_DOMAIN);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("platform_applications").select("*").order("category").order("name");
    setWorkspaces(data ?? []);
    const { data: assignments } = await supabase
      .from("workspace_assignments").select("workspace_id").is("revoked_at", null);
    const counts: Record<string, number> = {};
    for (const row of assignments ?? []) {
      counts[row.workspace_id] = (counts[row.workspace_id] ?? 0) + 1;
    }
    setAssignCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    supabase.from("platform_settings").select("value").eq("key", "workspace_email_domain").maybeSingle()
      .then(({ data }) => {
        if (typeof data?.value === "string") setDomain(data.value);
      });
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return workspaces.filter((w) =>
      (category === "All" || w.category === category) &&
      (!term || w.name.toLowerCase().includes(term) || w.slug.includes(term)),
    );
  }, [workspaces, search, category]);

  const saveDomain = async () => {
    const { error } = await supabase.from("platform_settings").upsert(
      { key: "workspace_email_domain", value: domain, updated_by: user?.id ?? null },
      { onConflict: "key" },
    );
    if (error) toast({ title: "Could not save domain", description: error.message, variant: "destructive" });
    else toast({ title: "Domain saved", description: `Workspace trial emails now use @${domain}` });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.launch_url.trim()) {
      toast({ title: "Missing fields", description: "Name and launch URL are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      slug: slugify(draft.slug || draft.name),
      description: draft.description,
      category: draft.category,
      icon: draft.category,
      icon_label: draft.icon_label || iconLabel(draft.name),
      icon_color: draft.icon_color,
      launch_url: draft.launch_url.trim(),
      status: draft.status,
      access_note: draft.access_note || null,
      workspace_email_enabled: draft.workspace_email_enabled,
      trial_signup_url: draft.trial_signup_url || null,
      username_placeholder: draft.username_placeholder,
      password_placeholder: draft.password_placeholder,
      login_binding_note: draft.login_binding_note,
      updated_by: user?.id ?? null,
    };
    const { error } = draft.id
      ? await supabase.from("platform_applications").update(payload).eq("id", draft.id)
      : await supabase.from("platform_applications").insert({ ...payload, created_by: user?.id ?? null });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: draft.id ? "Workspace updated" : "Workspace created" });
    setDraft(null);
    load();
  };

  const toggleStatus = async (w: Workspace) => {
    const next = w.status === "active" ? "inactive" : "active";
    const { error } = await supabase
      .from("platform_applications")
      .update({ status: next, updated_by: user?.id ?? null })
      .eq("id", w.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else load();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("platform_applications").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Workspace deleted" }); load(); }
  };

  const resetCatalog = async () => {
    setResetOpen(false);
    try {
      const rows = DEFAULT_WORKSPACE_CATALOG.map((w) => ({
        name: w.name,
        slug: slugify(w.name),
        description: w.description,
        category: w.category,
        icon: w.category,
        icon_label: iconLabel(w.name),
        icon_color: CATEGORY_COLORS[w.category],
        launch_url: w.launch_url,
        status: "active",
        workspace_email_enabled: w.workspace_email_enabled,
        trial_signup_url: w.trial_signup_url ?? null,
        username_placeholder: DEFAULT_USERNAME_PLACEHOLDER,
        password_placeholder: DEFAULT_PASSWORD_PLACEHOLDER,
        login_binding_note: DEFAULT_LOGIN_BINDING_NOTE,
        updated_by: user?.id ?? null,
      }));
      const { error } = await supabase
        .from("platform_applications")
        .upsert(rows, { onConflict: "slug" });
      if (error) throw error;
      toast({ title: "Catalog reset", description: `${rows.length} default workspaces restored.` });
      load();
    } catch (err) {
      toast({ title: "Reset failed", description: errorMessage(err), variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Workspace Catalog</h1>
            <p className="text-sm text-muted-foreground">
              Manage the platform-level Cloud Workspaces learners can launch. Assign learners from each card.
              This catalog is separate from the Workspaces launch-event audit.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => setResetOpen(true)}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset default catalog
            </Button>
            <Button size="sm" className="h-8" onClick={() => setDraft(emptyDraft())}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add workspace
            </Button>
          </div>
        </div>

        <Card className="rounded-md p-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="ws-domain" className="text-xs">Workspace trial email domain</Label>
            <Input id="ws-domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="h-8 mt-1" />
          </div>
          <Button size="sm" variant="secondary" className="h-8" onClick={saveDomain}>Save domain</Button>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search catalog" className="pl-8 h-9" aria-label="Search catalog"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["All", ...WORKSPACE_CATEGORIES].map((c) => (
              <Button
                key={c} size="sm" variant={category === c ? "secondary" : "ghost"}
                className="h-7 rounded-md text-xs" onClick={() => setCategory(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No workspaces"
            description="Add a workspace or reset the default catalog to get started."
          />
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((w) => {
              const Icon = workspaceIcon(w.category);
              return (
                <Card key={w.id} className="rounded-md p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                      style={{ backgroundColor: `${w.icon_color}1f`, color: w.icon_color }}
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{w.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{w.category} · {w.slug}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={w.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                        {w.status}
                      </Badge>
                      <Badge
                        variant={assignCounts[w.id] ? "outline" : "destructive"}
                        className="text-[10px]"
                      >
                        {assignCounts[w.id] ?? 0} assigned
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{w.description}</p>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={w.status === "active"}
                        onCheckedChange={() => toggleStatus(w)}
                        aria-label={`Toggle ${w.name}`}
                      />
                      {w.workspace_email_enabled && (
                        <Badge variant="outline" className="text-[10px]">Trial email</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={w.launch_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${w.name}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssignTarget(w)} aria-label={`Assign learners to ${w.name}`}>
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDraft(toDraft(w))} aria-label={`Edit ${w.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(w)} aria-label={`Delete ${w.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <WorkspaceAssignmentDialog
        workspace={assignTarget}
        onOpenChange={(open) => { if (!open) { setAssignTarget(null); void load(); } }}
      />

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit workspace" : "Add workspace"}</DialogTitle>
            <DialogDescription>Platform-level workspace — not tied to any VM lab template.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input className="h-8 mt-1" value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value, slug: draft.id ? draft.slug : slugify(e.target.value), icon_label: draft.id ? draft.icon_label : iconLabel(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Slug</Label>
                  <Input className="h-8 mt-1" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea className="mt-1 min-h-[60px]" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v, icon_color: CATEGORY_COLORS[v] ?? draft.icon_color })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORKSPACE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Icon label</Label>
                  <Input className="h-8 mt-1" value={draft.icon_label} onChange={(e) => setDraft({ ...draft, icon_label: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Icon color</Label>
                  <Input type="color" className="h-8 mt-1 p-1" value={draft.icon_color} onChange={(e) => setDraft({ ...draft, icon_color: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Launch URL</Label>
                <Input className="h-8 mt-1" value={draft.launch_url} onChange={(e) => setDraft({ ...draft, launch_url: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Access note</Label>
                <Input className="h-8 mt-1" value={draft.access_note} onChange={(e) => setDraft({ ...draft, access_note: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Workspace email / trial signup</p>
                  <p className="text-[11px] text-muted-foreground">Show the generated workspace email before launching.</p>
                </div>
                <Switch checked={draft.workspace_email_enabled} onCheckedChange={(v) => setDraft({ ...draft, workspace_email_enabled: v })} />
              </div>
              {draft.workspace_email_enabled && (
                <div>
                  <Label className="text-xs">Trial signup URL</Label>
                  <Input className="h-8 mt-1" value={draft.trial_signup_url} onChange={(e) => setDraft({ ...draft, trial_signup_url: e.target.value })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Username placeholder</Label>
                  <Input className="h-8 mt-1" value={draft.username_placeholder} onChange={(e) => setDraft({ ...draft, username_placeholder: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Password placeholder</Label>
                  <Input className="h-8 mt-1" value={draft.password_placeholder} onChange={(e) => setDraft({ ...draft, password_placeholder: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Login binding note</Label>
                <Textarea className="mt-1 min-h-[60px]" value={draft.login_binding_note} onChange={(e) => setDraft({ ...draft, login_binding_note: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <p className="text-xs font-medium text-foreground">Active</p>
                <Switch checked={draft.status === "active"} onCheckedChange={(v) => setDraft({ ...draft, status: v ? "active" : "inactive" })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save workspace"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the workspace from the catalog. Launch history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the default catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              Restores all {DEFAULT_WORKSPACE_CATALOG.length} built-in workspaces and overwrites matching entries.
              Custom workspaces are left untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetCatalog}>Reset catalog</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
