import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Trash2, Archive, CheckCircle2, Plus, Clock, CreditCard,
  Calendar, Cloud, Layers, Users as UsersIcon, BarChart3, UserPlus, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  PROVIDER_META, TEMPLATE_STATUS_STYLE, SESSION_STATUS_STYLE, formatDuration, formatCredit,
  type AccessTemplate, type TemplateBatch, type TemplateWorkspaceBatch, type CloudProvider,
  type AccessSession, type TemplateAssignment,
} from "@/lib/cloud-access";

const emptyBatch = { name: "", start_date: "", end_date: "", credit_allocation: 0, session_duration_override: null as number | null };
const emptyWsBatch = { name: "", start_date: "", end_date: "", shared_credit_pool: 0 };

interface Profile { user_id: string; display_name: string | null; email: string | null; }

export default function AccessTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tpl, setTpl] = useState<AccessTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<TemplateBatch[]>([]);
  const [wsBatches, setWsBatches] = useState<TemplateWorkspaceBatch[]>([]);
  const [sessions, setSessions] = useState<AccessSession[]>([]);
  const [assignments, setAssignments] = useState<TemplateAssignment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [batchDialog, setBatchDialog] = useState(false);
  const [batchDraft, setBatchDraft] = useState(emptyBatch);
  const [wsDialog, setWsDialog] = useState(false);
  const [wsDraft, setWsDraft] = useState(emptyWsBatch);
  const [assignDialog, setAssignDialog] = useState(false);
  const [assignUserId, setAssignUserId] = useState<string>("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    const [tplRes, bRes, wbRes, sRes, aRes, pRes] = await Promise.all([
      supabase.from("access_templates").select("*").eq("id", id).maybeSingle(),
      supabase.from("template_batches").select("*").eq("template_id", id).order("created_at", { ascending: false }),
      supabase.from("template_workspace_batches").select("*").eq("template_id", id).order("created_at", { ascending: false }),
      supabase.from("access_sessions").select("*").eq("template_id", id).order("started_at", { ascending: false }).limit(100),
      supabase.from("template_assignments").select("*").eq("template_id", id).is("revoked_at", null),
      supabase.from("profiles").select("user_id, display_name, email").limit(500),
    ]);
    setTpl(tplRes.data || null);
    setBatches(bRes.data || []);
    setWsBatches(wbRes.data || []);
    setSessions(sRes.data || []);
    setAssignments(aRes.data || []);
    setProfiles(pRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [id]);

  const meta = tpl ? PROVIDER_META[tpl.provider as CloudProvider] : null;

  const updateStatus = async (status: "draft" | "published" | "archived") => {
    if (!id) return;
    const { error } = await supabase.from("access_templates").update({ status }).eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: `Template ${status}` });
    fetchAll();
  };

  const toggleField = async (field: "self_enroll" | "refresh_allowed", value: boolean) => {
    if (!id) return;
    await supabase.from("access_templates").update({ [field]: value }).eq("id", id);
    fetchAll();
  };

  const deleteTemplate = async () => {
    if (!id) return;
    const { error } = await supabase.from("access_templates").delete().eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Template deleted" });
    navigate("/admin/access-catalogue");
  };

  const saveBatch = async () => {
    if (!id || !batchDraft.name.trim()) return toast({ title: "Batch name required", variant: "destructive" });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("template_batches").insert({
      template_id: id,
      name: batchDraft.name,
      start_date: batchDraft.start_date || null,
      end_date: batchDraft.end_date || null,
      credit_allocation: batchDraft.credit_allocation,
      session_duration_override: batchDraft.session_duration_override,
      created_by: user?.id,
    });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Batch created" });
    setBatchDialog(false);
    setBatchDraft(emptyBatch);
    fetchAll();
  };

  const togglePublishBatch = async (b: TemplateBatch) => {
    await supabase.from("template_batches").update({ published: !b.published }).eq("id", b.id);
    fetchAll();
  };
  const deleteBatch = async (bid: string) => {
    await supabase.from("template_batches").delete().eq("id", bid);
    fetchAll();
  };

  const saveWsBatch = async () => {
    if (!id || !wsDraft.name.trim()) return toast({ title: "Name required", variant: "destructive" });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("template_workspace_batches").insert({
      template_id: id,
      name: wsDraft.name,
      start_date: wsDraft.start_date || null,
      end_date: wsDraft.end_date || null,
      shared_credit_pool: wsDraft.shared_credit_pool,
      created_by: user?.id,
    });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setWsDialog(false);
    setWsDraft(emptyWsBatch);
    fetchAll();
  };

  const togglePublishWs = async (b: TemplateWorkspaceBatch) => {
    await supabase.from("template_workspace_batches").update({ published: !b.published }).eq("id", b.id);
    fetchAll();
  };
  const deleteWs = async (bid: string) => {
    await supabase.from("template_workspace_batches").delete().eq("id", bid);
    fetchAll();
  };

  const addAssignment = async () => {
    if (!id || !assignUserId) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("template_assignments").insert({
      template_id: id,
      assignee_type: "user",
      assignee_id: assignUserId,
      granted_by: user?.id,
    });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "User assigned" });
    setAssignDialog(false);
    setAssignUserId("");
    fetchAll();
  };

  const removeAssignment = async (aid: string) => {
    await supabase.from("template_assignments").update({ revoked_at: new Date().toISOString() }).eq("id", aid);
    fetchAll();
  };

  if (loading) {
    return <DashboardLayout><div className="p-8 text-sm text-muted-foreground">Loading template...</div></DashboardLayout>;
  }
  if (!tpl || !meta) {
    return <DashboardLayout><div className="p-8"><EmptyState icon={Cloud} title="Template not found" description="It may have been deleted or you no longer have access." /></div></DashboardLayout>;
  }

  const profileFor = (uid: string | null) => profiles.find((p) => p.user_id === uid);
  const stats = {
    total: sessions.length,
    active: sessions.filter((s) => s.status === "active").length,
    expired: sessions.filter((s) => s.status === "expired").length,
    refreshed: sessions.reduce((a, s) => a + (s.refresh_count || 0), 0),
    creditUsed: sessions.reduce((a, s) => a + Number(s.credit_consumed || 0), 0),
  };

  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <button onClick={() => navigate("/admin/access-catalogue")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Machine Catalogue
        </button>

        <motion.header
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border ${meta.bg} p-5 sm:p-6`}
        >
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-mono font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                <Badge variant="outline" className={TEMPLATE_STATUS_STYLE[tpl.status]}>{tpl.status}</Badge>
                {tpl.self_enroll && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">self-enroll</Badge>}
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mt-1">{tpl.name}</h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-3xl">{tpl.description || meta.tagline}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <Stat icon={Clock} label="Validity" value={`${tpl.validity_days}d`} />
                <Stat icon={CreditCard} label="Credit" value={formatCredit(tpl.credit_limit)} />
                <Stat icon={Calendar} label="Session" value={formatDuration(tpl.session_duration_minutes)} />
                <Stat icon={Cloud} label="Region" value={tpl.region || "—"} />
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:w-48">
              {tpl.status !== "published" && (
                <Button onClick={() => updateStatus("published")} className="w-full">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" /> Publish
                </Button>
              )}
              {tpl.status === "published" && (
                <Button variant="outline" onClick={() => updateStatus("draft")} className="w-full">
                  Unpublish (draft)
                </Button>
              )}
              {tpl.status !== "archived" && (
                <Button variant="outline" onClick={() => updateStatus("archived")} className="w-full">
                  <Archive className="h-4 w-4 mr-1.5" /> Archive
                </Button>
              )}
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} className="w-full">
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
              <div className="flex items-center justify-between pt-3 mt-2 border-t border-border/40">
                <Label className="text-[11px] text-muted-foreground">Self-enroll</Label>
                <Switch checked={tpl.self_enroll} onCheckedChange={(v) => toggleField("self_enroll", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Refresh allowed</Label>
                <Switch checked={tpl.refresh_allowed} onCheckedChange={(v) => toggleField("refresh_allowed", v)} />
              </div>
            </div>
          </div>
        </motion.header>

        <Tabs defaultValue="batch" className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="batch">Batch ({batches.length})</TabsTrigger>
            <TabsTrigger value="assignments">Assignments ({assignments.length})</TabsTrigger>
            <TabsTrigger value="workspace">Workspace Batch ({wsBatches.length})</TabsTrigger>
            <TabsTrigger value="reports"><BarChart3 className="h-3.5 w-3.5 mr-1" />Reports</TabsTrigger>
          </TabsList>

          {/* BATCH TAB */}
          <TabsContent value="batch" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button onClick={() => setBatchDialog(true)}><Plus className="h-4 w-4 mr-1.5" /> Add Batch</Button>
            </div>
            {batches.length === 0 ? (
              <EmptyState icon={Layers} title="No batches yet" description="Create a batch to assign this template to a cohort of users with shared dates and credits." />
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch Name</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Credit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.start_date || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.end_date || "—"}</TableCell>
                        <TableCell className="text-xs">{formatCredit(b.credit_allocation)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={b.published ? "bg-success/10 text-success border-success/30" : "bg-muted text-muted-foreground"}>
                            {b.published ? "published" : "draft"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => togglePublishBatch(b)}>
                            {b.published ? "Unpublish" : "Publish"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteBatch(b.id)} className="text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ASSIGNMENTS TAB */}
          <TabsContent value="assignments" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button onClick={() => setAssignDialog(true)}><UserPlus className="h-4 w-4 mr-1.5" /> Assign User</Button>
            </div>
            {assignments.length === 0 ? (
              <EmptyState icon={UsersIcon} title="No assignments" description="Assign users directly, or enable self-enroll on the template header for any signed-in user to access." />
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>User / Org</TableHead><TableHead>Granted</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {assignments.map((a) => {
                      const p = profileFor(a.assignee_id);
                      return (
                        <TableRow key={a.id}>
                          <TableCell><Badge variant="outline">{a.assignee_type}</Badge></TableCell>
                          <TableCell className="text-sm">{p?.display_name || p?.email || a.assignee_id?.slice(0, 8) || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(a.granted_at).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => removeAssignment(a.id)} className="text-destructive">
                              <X className="h-3.5 w-3.5" /> Revoke
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* WORKSPACE TAB */}
          <TabsContent value="workspace" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button onClick={() => setWsDialog(true)}><Plus className="h-4 w-4 mr-1.5" /> Add Workspace Batch</Button>
            </div>
            {wsBatches.length === 0 ? (
              <EmptyState icon={UsersIcon} title="No workspace batches" description="Workspace batches share a credit pool across a team or organization." />
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Shared Pool</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {wsBatches.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.start_date || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.end_date || "—"}</TableCell>
                        <TableCell className="text-xs">{formatCredit(b.shared_credit_pool)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={b.published ? "bg-success/10 text-success border-success/30" : "bg-muted text-muted-foreground"}>
                            {b.published ? "published" : "draft"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => togglePublishWs(b)}>{b.published ? "Unpublish" : "Publish"}</Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteWs(b.id)} className="text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* REPORTS TAB */}
          <TabsContent value="reports" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <ReportTile label="Sessions" value={stats.total} />
              <ReportTile label="Active" value={stats.active} accent="text-success" />
              <ReportTile label="Expired" value={stats.expired} accent="text-warning" />
              <ReportTile label="Refreshes" value={stats.refreshed} />
              <ReportTile label="Credit Used" value={formatCredit(stats.creditUsed)} />
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-sm font-medium">Recent Sessions</div>
              {sessions.length === 0 ? (
                <div className="p-6"><EmptyState icon={BarChart3} title="No sessions yet" description="Sessions appear here as soon as entitled users start generating links." /></div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Started</TableHead><TableHead>Expires</TableHead><TableHead>Refresh</TableHead><TableHead>Credit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sessions.slice(0, 20).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{profileFor(s.user_id)?.display_name || profileFor(s.user_id)?.email || s.user_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(s.expires_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{s.refresh_count}</TableCell>
                        <TableCell className="text-xs">{formatCredit(s.credit_consumed)}</TableCell>
                        <TableCell><Badge variant="outline" className={SESSION_STATUS_STYLE[s.status]}>{s.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* CREATE BATCH DIALOG */}
        <Dialog open={batchDialog} onOpenChange={setBatchDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Batch</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Batch name</Label><Input value={batchDraft.name} onChange={(e) => setBatchDraft({ ...batchDraft, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start date</Label><Input type="date" value={batchDraft.start_date} onChange={(e) => setBatchDraft({ ...batchDraft, start_date: e.target.value })} /></div>
                <div><Label>End date</Label><Input type="date" value={batchDraft.end_date} onChange={(e) => setBatchDraft({ ...batchDraft, end_date: e.target.value })} /></div>
                <div><Label>Credit allocation</Label><Input type="number" min={0} value={batchDraft.credit_allocation} onChange={(e) => setBatchDraft({ ...batchDraft, credit_allocation: Number(e.target.value) })} /></div>
                <div><Label>Session minutes (override)</Label><Input type="number" min={0} value={batchDraft.session_duration_override ?? ""} onChange={(e) => setBatchDraft({ ...batchDraft, session_duration_override: e.target.value ? Number(e.target.value) : null })} /></div>
              </div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setBatchDialog(false)}>Cancel</Button><Button onClick={saveBatch}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CREATE WS DIALOG */}
        <Dialog open={wsDialog} onOpenChange={setWsDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Workspace Batch</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={wsDraft.name} onChange={(e) => setWsDraft({ ...wsDraft, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start date</Label><Input type="date" value={wsDraft.start_date} onChange={(e) => setWsDraft({ ...wsDraft, start_date: e.target.value })} /></div>
                <div><Label>End date</Label><Input type="date" value={wsDraft.end_date} onChange={(e) => setWsDraft({ ...wsDraft, end_date: e.target.value })} /></div>
                <div className="col-span-2"><Label>Shared credit pool</Label><Input type="number" min={0} value={wsDraft.shared_credit_pool} onChange={(e) => setWsDraft({ ...wsDraft, shared_credit_pool: Number(e.target.value) })} /></div>
              </div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setWsDialog(false)}>Cancel</Button><Button onClick={saveWsBatch}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ASSIGN DIALOG */}
        <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign User</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Label>Select user</Label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger><SelectValue placeholder="Choose a user..." /></SelectTrigger>
                <SelectContent>
                  {profiles
                    .filter((p) => !assignments.some((a) => a.assignee_id === p.user_id && a.assignee_type === "user"))
                    .map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || p.email || p.user_id.slice(0, 8)}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setAssignDialog(false)}>Cancel</Button><Button onClick={addAssignment} disabled={!assignUserId}>Assign</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this template?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the template, its batches, workspace batches, assignments, and session history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={deleteTemplate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 border border-border/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-base font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function ReportTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent || "text-foreground"}`}>{value}</div>
    </div>
  );
}
