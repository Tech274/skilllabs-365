import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Monitor, Terminal, Copy, MoreVertical, Play, Loader2, UserPlus, X, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/function-error";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";
import {
  endDateFromDuration,
  formatIstDate,
  istDateToEndIso,
  istDateToStartIso,
  toIstDateInput,
  validatePrepaidMinutes,
  validateTemplateWindow,
} from "@/lib/lab-template-window";

type LabTemplate = Tables<"lab_templates">;

interface LabForm {
  name: string;
  description: string;
  protocol: string;
  vm_size: string;
  os_image: string;
  duration: number;
  idle_timeout: number;
  is_persistent: boolean;
  clipboard_enabled: boolean;
  file_transfer_enabled: boolean;
  region: string;
  status: string;
  provider_account_id: string;
  /** Persistent labs only — Asia/Kolkata calendar dates (YYYY-MM-DD). */
  start_date: string;
  end_date: string;
}

const emptyForm: LabForm = {
  name: '', description: '', protocol: 'RDP', vm_size: 'Standard_B2s', os_image: 'Windows Server 2022',
  duration: 120, idle_timeout: 20, is_persistent: false, clipboard_enabled: true, file_transfer_enabled: false, region: 'All Regions', status: 'draft', provider_account_id: '',
  start_date: '', end_date: '',
};

const AZURE_VM_SIZES = [
  { value: "Standard_B2s", label: "B2s (2 vCPU, 4 GB)" },
  { value: "Standard_B2ms", label: "B2ms (2 vCPU, 8 GB)" },
  { value: "Standard_B4ms", label: "B4ms (4 vCPU, 16 GB)" },
  { value: "Standard_D2s_v3", label: "D2s v3 (2 vCPU, 8 GB)" },
] as const;

/** EC2 types shown when Resource Provider is AWS (SkillTrack AWS default). */
const AWS_VM_SIZES = [
  { value: "t3.small", label: "t3.small (2 vCPU, 2 GB)" },
  { value: "t3.medium", label: "t3.medium (2 vCPU, 4 GB)" },
  { value: "t3.large", label: "t3.large (2 vCPU, 8 GB)" },
  { value: "t3.xlarge", label: "t3.xlarge (4 vCPU, 16 GB)" },
] as const;

const DEFAULT_VM_SIZE: Record<"aws" | "azure", string> = {
  aws: "t3.medium",
  azure: "Standard_B2s",
};

function sizesForProvider(provider: string | undefined | null) {
  return provider === "aws" ? AWS_VM_SIZES : AZURE_VM_SIZES;
}

function defaultSizeForProvider(provider: string | undefined | null) {
  return provider === "aws" ? DEFAULT_VM_SIZE.aws : DEFAULT_VM_SIZE.azure;
}

const statusStyle: Record<string, string> = {
  published: 'bg-success/10 text-success',
  draft: 'bg-warning/10 text-warning',
  archived: 'bg-muted text-muted-foreground',
};

interface ProviderAccount {
  id: string;
  provider: string;
  display_name: string;
  status: string;
  is_default: boolean;
  default_region: string | null;
}

/** Prefer is_default so Create Lab shows AWS t3.* immediately (not Azure B2s). */
function pickDefaultProviderAccount(accounts: ProviderAccount[]) {
  return (
    accounts.find((a) => a.is_default) ??
    accounts.find((a) => a.provider === "aws") ??
    accounts[0] ??
    null
  );
}

interface InstructorProfile {
  user_id: string;
  display_name: string;
  email: string | null;
}

export default function LabManagement() {
  const navigate = useNavigate();
  const [labs, setLabs] = useState<LabTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLab, setEditingLab] = useState<LabTemplate | null>(null);
  const [form, setForm] = useState<LabForm>(emptyForm);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [durationDays, setDurationDays] = useState("");
  const windowError = validateTemplateWindow({
    isPersistent: form.is_persistent,
    startDate: form.start_date,
    endDate: form.end_date,
  });

  // Assignment state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningLab, setAssigningLab] = useState<LabTemplate | null>(null);
  const [instructors, setInstructors] = useState<InstructorProfile[]>([]);
  const [assignedInstructorIds, setAssignedInstructorIds] = useState<string[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingLab, setDeletingLab] = useState<LabTemplate | null>(null);
  const [genLoading, setGenLoading] = useState(false);

  // Every template must point at a Resource Provider account — provisioning is blocked otherwise.
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([]);

  const formProvider = providerAccounts.find((a) => a.id === form.provider_account_id)?.provider;
  const vmSizeOptions = sizesForProvider(formProvider);
  // Keep Select value valid when switching AWS ↔ Azure (SkillTrack AWS must not show B2s).
  const vmSizeValue = vmSizeOptions.some((o) => o.value === form.vm_size)
    ? form.vm_size
    : defaultSizeForProvider(formProvider);


  const fetchProviderAccounts = async () => {
    const { data } = await supabase.functions.invoke<{ accounts: ProviderAccount[] }>("cloud-provider-accounts", {
      body: { action: "list" },
    });
    setProviderAccounts((data?.accounts ?? []).filter(a =>
      (a.provider === "aws" || a.provider === "azure") && a.status === "active",
    ));
  };

  const fetchLabs = async () => {
    const { data, error } = await supabase.from("lab_templates").select("*").order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error", description: "Failed to load lab templates.", variant: "destructive" });
    } else {
      setLabs(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchLabs(); fetchProviderAccounts(); }, []);

  // P0d: if Create opened before accounts arrived, auto-select is_default once listed.
  useEffect(() => {
    if (!dialogOpen || editingLab) return;
    if (form.provider_account_id) return;
    const def = pickDefaultProviderAccount(providerAccounts);
    if (!def) return;
    setForm((f) => ({
      ...f,
      provider_account_id: def.id,
      vm_size: defaultSizeForProvider(def.provider),
      region: def.default_region || f.region,
    }));
  }, [providerAccounts, dialogOpen, editingLab, form.provider_account_id]);

  const openCreate = () => {
    setEditingLab(null);
    const def = pickDefaultProviderAccount(providerAccounts);
    setForm({
      ...emptyForm,
      provider_account_id: def?.id ?? "",
      vm_size: defaultSizeForProvider(def?.provider),
      region: def?.default_region || emptyForm.region,
    });
    setDurationDays("");
    setDialogOpen(true);
  };

  const openEdit = (lab: LabTemplate) => {
    setEditingLab(lab);
    setForm({
      name: lab.name, description: lab.description || '', protocol: lab.protocol,
      vm_size: lab.vm_size, os_image: lab.os_image, duration: lab.duration,
      idle_timeout: lab.idle_timeout, is_persistent: lab.is_persistent, clipboard_enabled: lab.clipboard_enabled,
      file_transfer_enabled: lab.file_transfer_enabled, region: lab.region, status: lab.status,
      provider_account_id: lab.provider_account_id ?? '',
      start_date: toIstDateInput(lab.start_date),
      end_date: toIstDateInput(lab.end_date),
    });
    setDurationDays("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const minutesError = validatePrepaidMinutes(form.duration);
    if (minutesError) {
      toast({ title: "Total minutes required", description: minutesError, variant: "destructive" });
      return;
    }
    if (windowError) {
      toast({ title: "Lab window invalid", description: windowError, variant: "destructive" });
      return;
    }
    if (!form.provider_account_id) {
      toast({
        title: "Resource provider required",
        description: "Pick the AWS or Azure account this lab provisions into (Admin → Resource Providers).",
        variant: "destructive",
      });
      return;
    }
    const selectedProvider = providerAccounts.find((account) => account.id === form.provider_account_id)?.provider;
    if (selectedProvider !== "aws" && selectedProvider !== "azure") {
      toast({ title: "Supported provider required", description: "Choose an active AWS or Azure account.", variant: "destructive" });
      return;
    }
    const { start_date, end_date, ...formFields } = form;
    const sizeOptions = sizesForProvider(selectedProvider);
    const coercedSize = sizeOptions.some((o) => o.value === form.vm_size)
      ? form.vm_size
      : defaultSizeForProvider(selectedProvider);
    const payload = {
      ...formFields,
      vm_size: coercedSize,
      provider: selectedProvider as "aws" | "azure",
      // Persistent: prepaid duration + IST access window. Non-persistent: prepaid duration only.
      start_date: form.is_persistent ? istDateToStartIso(start_date) : null,
      end_date: form.is_persistent ? istDateToEndIso(end_date) : null,
    };
    if (editingLab) {
      const { error } = await supabase.from("lab_templates").update(payload).eq("id", editingLab.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Lab updated", description: `${form.name} has been updated.` });
    } else {
      const insert: TablesInsert<"lab_templates"> = { ...payload };
      const { error } = await supabase.from("lab_templates").insert(insert);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Lab created", description: `${form.name} has been created.` });
    }
    setDialogOpen(false);
    fetchLabs();
  };

  const confirmDelete = (lab: LabTemplate) => {
    setDeletingLab(lab);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingLab) return;
    const { error } = await supabase.from("lab_templates").delete().eq("id", deletingLab.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setLabs(prev => prev.filter(l => l.id !== deletingLab.id));
    toast({ title: "Lab deleted", description: `${deletingLab.name} has been removed.` });
    setDeleteDialogOpen(false);
    setDeletingLab(null);
  };

  const handleDuplicate = async (lab: LabTemplate) => {
    const insert: TablesInsert<"lab_templates"> = {
      name: `${lab.name} (Copy)`, description: lab.description, protocol: lab.protocol,
      vm_size: lab.vm_size, os_image: lab.os_image, duration: lab.duration,
      idle_timeout: lab.idle_timeout, is_persistent: lab.is_persistent, clipboard_enabled: lab.clipboard_enabled,
      file_transfer_enabled: lab.file_transfer_enabled, region: lab.region, status: 'draft',
    };
    const { error } = await supabase.from("lab_templates").insert(insert);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Lab duplicated", description: `${lab.name} (Copy) created as draft.` });
    fetchLabs();
  };

  const handleLaunchLab = async (lab: LabTemplate) => {
    setLaunchingId(lab.id);
    try {
      const { data, error } = await supabase.functions.invoke("provision-lab", {
        body: { lab_template_id: lab.id },
        headers: idempotencyHeaders(`provision:${lab.id}`),
      });
      if (error || data?.error) throw new Error(await readFunctionError(error, data));
      toast({ title: "VM Ready", description: "Redirecting to your lab session..." });
      navigate(`/labs/session/${lab.id}?vm_id=${data.vm_id}`);
    } catch (err: any) {
      // Failed attempt: next click should be a fresh provisioning operation.
      resetIdempotency(`provision:${lab.id}`);
      toast({ title: "Launch Failed", description: err.message || "Failed to provision VM.", variant: "destructive" });
    } finally {
      setLaunchingId(null);
    }
  };

  const openAssignDialog = async (lab: LabTemplate) => {
    setAssigningLab(lab);
    setAssignLoading(true);
    setAssignDialogOpen(true);
    const [roleRes, assignRes] = await Promise.all([
      supabase.from("user_roles").select("user_id").eq("role", "instructor"),
      supabase.from("lab_assignments").select("instructor_id").eq("lab_template_id", lab.id),
    ]);
    const instructorUserIds = roleRes.data?.map(r => r.user_id) ?? [];
    setAssignedInstructorIds(assignRes.data?.map(a => a.instructor_id) ?? []);
    if (instructorUserIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", instructorUserIds);
      setInstructors(profiles ?? []);
    } else {
      setInstructors([]);
    }
    setAssignLoading(false);
  };

  const handleAssign = async (instructorId: string) => {
    if (!assigningLab) return;
    const { error } = await supabase.from("lab_assignments").insert({ lab_template_id: assigningLab.id, instructor_id: instructorId });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setAssignedInstructorIds(prev => [...prev, instructorId]);
    toast({ title: "Assigned", description: "Instructor assigned to lab." });
  };

  const handleUnassign = async (instructorId: string) => {
    if (!assigningLab) return;
    const { error } = await supabase.from("lab_assignments").delete().eq("lab_template_id", assigningLab.id).eq("instructor_id", instructorId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setAssignedInstructorIds(prev => prev.filter(id => id !== instructorId));
    toast({ title: "Removed", description: "Instructor removed from lab." });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Lab Management</h1>
            <p className="text-sm text-muted-foreground mt-1">{labs.length} lab templates configured</p>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Create Lab Template</Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : labs.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground"><p className="text-sm">No lab templates yet. Create one to get started.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {labs.map((lab, i) => (
              <motion.div key={lab.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {lab.protocol.toUpperCase() === 'RDP' ? <Monitor className="h-4 w-4 text-primary" /> : <Terminal className="h-4 w-4 text-success" />}
                    <h3 className="text-sm font-semibold text-foreground">{lab.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", statusStyle[lab.status] || statusStyle.draft)}>{lab.status}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted transition-colors"><MoreVertical className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(lab)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(lab)}><Copy className="h-3.5 w-3.5 mr-2" /> Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAssignDialog(lab)}><UserPlus className="h-3.5 w-3.5 mr-2" /> Assign Instructors</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => confirmDelete(lab)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{lab.description}</p>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-sm font-mono font-semibold text-foreground">{`${lab.duration}m`}</p>
                    <p className="text-[9px] text-muted-foreground uppercase">Total minutes</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-sm font-mono font-semibold text-foreground">{lab.idle_timeout}m</p>
                    <p className="text-[9px] text-muted-foreground uppercase">Idle Timeout</p>
                  </div>
                </div>
                {lab.is_persistent && (lab.start_date || lab.end_date) && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    Access window: {formatIstDate(lab.start_date)} → {formatIstDate(lab.end_date)}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono">{lab.vm_size}</Badge>
                  <Badge variant="outline" className="text-[10px]">{lab.protocol}</Badge>
                  <Badge variant="outline" className="text-[10px]">{lab.region}</Badge>
                  <Badge variant="outline" className={cn("text-[10px]", lab.is_persistent ? "text-success border-success/30" : "")}>{lab.is_persistent ? "Persistent" : "Non-persistent"}</Badge>
                  {!lab.clipboard_enabled && <Badge variant="outline" className="text-[10px] text-warning border-warning/30">No Clipboard</Badge>}
                </div>
                {lab.status === 'published' && (
                  <Button size="sm" className="w-full gap-2" disabled={launchingId === lab.id} onClick={() => handleLaunchLab(lab)}>
                    {launchingId === lab.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning...</> : <><Play className="h-3.5 w-3.5" /> Launch Lab</>}
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingLab ? 'Edit Lab Template' : 'Create Lab Template'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Lab Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Azure Fundamentals" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Description</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-primary hover:bg-primary/10 h-7 text-xs"
                    disabled={!form.name.trim() || genLoading}
                    onClick={async () => {
                      setGenLoading(true);
                      try {
                        const { data: result, error } = await supabase.functions.invoke("ai-assistant", {
                          body: { type: "lab_description", data: { name: form.name, protocol: form.protocol, vm_size: form.vm_size, os_image: form.os_image, duration: form.duration } },
                        });
                        if (!error && result?.insight) setForm(f => ({ ...f, description: result.insight }));
                      } catch {} finally { setGenLoading(false); }
                    }}
                  >
                    {genLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Generate with AI
                  </Button>
                </div>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Lab description..." rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Resource Provider</Label>
                <Select
                  value={form.provider_account_id}
                  onValueChange={(v) => {
                    const nextProvider = providerAccounts.find((a) => a.id === v)?.provider;
                    const nextSizes = sizesForProvider(nextProvider);
                    const keep = nextSizes.some((o) => o.value === form.vm_size);
                    setForm({
                      ...form,
                      provider_account_id: v,
                      vm_size: keep ? form.vm_size : defaultSizeForProvider(nextProvider),
                    });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select a resource provider account" /></SelectTrigger>
                  <SelectContent>
                    {providerAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.display_name}{a.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {providerAccounts.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No active AWS or Azure accounts yet — add one under Admin → Resource Providers.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <Select value={form.protocol} onValueChange={v => setForm({ ...form, protocol: v, os_image: v === 'RDP' ? 'Windows Server 2022' : 'Ubuntu 22.04 LTS' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RDP">RDP (Windows)</SelectItem>
                      <SelectItem value="SSH">SSH (Linux)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>VM Size{formProvider === "aws" ? " (EC2)" : formProvider === "azure" ? " (Azure)" : ""}</Label>
                  <Select
                    value={vmSizeValue}
                    onValueChange={(v) => setForm({ ...form, vm_size: v })}
                  >
                    <SelectTrigger><SelectValue placeholder={formProvider === "aws" ? "Select EC2 type" : "Select Azure size"} /></SelectTrigger>
                    <SelectContent>
                      {vmSizeOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Persistence</Label>
                  <Select value={form.is_persistent ? "persistent" : "non-persistent"} onValueChange={v => setForm({ ...form, is_persistent: v === "persistent" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="persistent">Persistent</SelectItem>
                      <SelectItem value="non-persistent">Non-persistent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Total minutes</Label>
                  <Input type="number" min={1} value={form.duration} onChange={e => setForm({ ...form, duration: Number(e.target.value) })} />
                  {form.is_persistent && (
                    <p className="text-[10px] text-muted-foreground">
                      Prepaid session pool (e.g. 200). Learners use any session lengths until minutes exhaust inside the date window — not unlimited.
                    </p>
                  )}
                </div>
              </div>
              {form.is_persistent && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start date (IST)</Label>
                      <Input
                        type="date"
                        value={form.start_date}
                        onChange={e => setForm({ ...form, start_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End date (IST)</Label>
                      <Input
                        type="date"
                        value={form.end_date}
                        min={form.start_date || undefined}
                        onChange={e => setForm({ ...form, end_date: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Set end date from calendar days</Label>
                      <Input
                        type="number"
                        min={1}
                        placeholder="e.g. 30"
                        value={durationDays}
                        onChange={e => {
                          const v = e.target.value;
                          setDurationDays(v);
                          const computed = endDateFromDuration(form.start_date, Number(v));
                          if (computed) setForm(f => ({ ...f, end_date: computed }));
                        }}
                      />
                    </div>
                  </div>
                  {windowError ? (
                    <p className="text-xs text-destructive">{windowError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Start→end is the access window only (IST), not a 24/7 always-on VM. Sessions of any length
                      run until prepaid Total minutes exhaust inside the window. End of end date (EOD IST)
                      deallocates and notifies — never silently terminated. Leave/soft-stop holds the same VM.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Idle Timeout (minutes)</Label>
                  <Input type="number" value={form.idle_timeout} onChange={e => setForm({ ...form, idle_timeout: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={form.region} onValueChange={v => setForm({ ...form, region: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All Regions">All Regions</SelectItem>
                    <SelectItem value="East US">East US</SelectItem>
                    <SelectItem value="Central India">Central India</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <div>
                  <p className="text-sm text-foreground">Clipboard Access</p>
                  <p className="text-xs text-muted-foreground">Allow copy/paste between host and VM</p>
                </div>
                <Switch checked={form.clipboard_enabled} onCheckedChange={v => setForm({ ...form, clipboard_enabled: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <div>
                  <p className="text-sm text-foreground">File Transfer</p>
                  <p className="text-xs text-muted-foreground">Allow file upload/download</p>
                </div>
                <Switch checked={form.file_transfer_enabled} onCheckedChange={v => setForm({ ...form, file_transfer_enabled: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name.trim() || !Number.isFinite(form.duration) || form.duration <= 0 || Boolean(windowError)}>{editingLab ? 'Save Changes' : 'Create Lab'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Instructors Dialog */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Assign Instructors — {assigningLab?.name}</DialogTitle></DialogHeader>
            {assignLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : instructors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No instructors found. Promote a user to instructor role first.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {instructors.map(inst => {
                  const isAssigned = assignedInstructorIds.includes(inst.user_id);
                  return (
                    <div key={inst.user_id} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{inst.display_name}</p>
                        <p className="text-xs text-muted-foreground">{inst.email}</p>
                      </div>
                      {isAssigned ? (
                        <Button size="sm" variant="outline" className="gap-1 text-destructive hover:text-destructive" onClick={() => handleUnassign(inst.user_id)}>
                          <X className="h-3 w-3" /> Remove
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => handleAssign(inst.user_id)}>
                          <UserPlus className="h-3 w-3" /> Assign
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Lab Template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{deletingLab?.name}</strong>? This action cannot be undone. All associated assignments will also be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
