import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Monitor, Terminal, Clock, Users, Copy, MoreVertical, Play, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type LabTemplate = Tables<"lab_templates">;

interface LabForm {
  name: string;
  description: string;
  protocol: string;
  vm_size: string;
  os_image: string;
  duration: number;
  idle_timeout: number;
  clipboard_enabled: boolean;
  file_transfer_enabled: boolean;
  region: string;
  status: string;
}

const emptyForm: LabForm = {
  name: '', description: '', protocol: 'RDP', vm_size: 'Standard_B2s', os_image: 'Windows Server 2022',
  duration: 120, idle_timeout: 20, clipboard_enabled: true, file_transfer_enabled: false, region: 'All Regions', status: 'draft',
};

const statusStyle: Record<string, string> = {
  active: 'bg-success/10 text-success',
  draft: 'bg-warning/10 text-warning',
  archived: 'bg-muted text-muted-foreground',
};

export default function LabManagement() {
  const navigate = useNavigate();
  const [labs, setLabs] = useState<LabTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLab, setEditingLab] = useState<LabTemplate | null>(null);
  const [form, setForm] = useState<LabForm>(emptyForm);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const fetchLabs = async () => {
    const { data, error } = await supabase.from("lab_templates").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to fetch labs:", error);
      toast({ title: "Error", description: "Failed to load lab templates.", variant: "destructive" });
    } else {
      setLabs(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchLabs(); }, []);

  const openCreate = () => {
    setEditingLab(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (lab: LabTemplate) => {
    setEditingLab(lab);
    setForm({
      name: lab.name, description: lab.description || '', protocol: lab.protocol,
      vm_size: lab.vm_size, os_image: lab.os_image, duration: lab.duration,
      idle_timeout: lab.idle_timeout, clipboard_enabled: lab.clipboard_enabled,
      file_transfer_enabled: lab.file_transfer_enabled, region: lab.region, status: lab.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingLab) {
      const { error } = await supabase.from("lab_templates").update(form).eq("id", editingLab.id);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Lab updated", description: `${form.name} has been updated.` });
    } else {
      const insert: TablesInsert<"lab_templates"> = { ...form };
      const { error } = await supabase.from("lab_templates").insert(insert);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Lab created", description: `${form.name} has been created.` });
    }
    setDialogOpen(false);
    fetchLabs();
  };

  const handleDelete = async (id: string) => {
    const lab = labs.find(l => l.id === id);
    const { error } = await supabase.from("lab_templates").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setLabs(prev => prev.filter(l => l.id !== id));
    toast({ title: "Lab deleted", description: `${lab?.name} has been removed.` });
  };

  const handleDuplicate = async (lab: LabTemplate) => {
    const insert: TablesInsert<"lab_templates"> = {
      name: `${lab.name} (Copy)`, description: lab.description, protocol: lab.protocol,
      vm_size: lab.vm_size, os_image: lab.os_image, duration: lab.duration,
      idle_timeout: lab.idle_timeout, clipboard_enabled: lab.clipboard_enabled,
      file_transfer_enabled: lab.file_transfer_enabled, region: lab.region, status: 'draft',
    };
    const { error } = await supabase.from("lab_templates").insert(insert);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Lab duplicated", description: `${lab.name} (Copy) created as draft.` });
    fetchLabs();
  };

  const handleLaunchLab = async (lab: LabTemplate) => {
    setLaunchingId(lab.id);
    toast({ title: "Provisioning VM", description: `Starting ${lab.name}... This may take a minute.` });

    try {
      const { data, error } = await supabase.functions.invoke("provision-lab", {
        body: { lab_template_id: lab.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: "VM Ready", description: "Redirecting to your lab session..." });

      // Navigate to session page with the vm_id so it creates a Guacamole session
      navigate(`/labs/session/${lab.id}?vm_id=${data.vm_id}`);
    } catch (err: any) {
      console.error("Launch lab failed:", err);
      toast({ title: "Launch Failed", description: err.message || "Failed to provision VM.", variant: "destructive" });
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Lab Management</h1>
            <p className="text-sm text-muted-foreground mt-1">{labs.length} lab templates configured</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Create Lab Template
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : labs.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-sm">No lab templates yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {labs.map((lab, i) => (
              <motion.div
                key={lab.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {lab.protocol.toUpperCase() === 'RDP' ? <Monitor className="h-4 w-4 text-primary" /> : <Terminal className="h-4 w-4 text-success" />}
                    <h3 className="text-sm font-semibold text-foreground">{lab.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", statusStyle[lab.status] || statusStyle.draft)}>
                      {lab.status}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted transition-colors">
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(lab)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(lab)}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(lab.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2">{lab.description}</p>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-sm font-mono font-semibold text-foreground">{lab.duration}m</p>
                    <p className="text-[9px] text-muted-foreground uppercase">Duration</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-sm font-mono font-semibold text-foreground">{lab.idle_timeout}m</p>
                    <p className="text-[9px] text-muted-foreground uppercase">Idle Timeout</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono">{lab.vm_size}</Badge>
                  <Badge variant="outline" className="text-[10px]">{lab.protocol}</Badge>
                  <Badge variant="outline" className="text-[10px]">{lab.region}</Badge>
                  {!lab.clipboard_enabled && <Badge variant="outline" className="text-[10px] text-warning border-warning/30">No Clipboard</Badge>}
                </div>

                {lab.status === 'active' && (
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    disabled={launchingId === lab.id}
                    onClick={() => handleLaunchLab(lab)}
                  >
                    {launchingId === lab.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" /> Launch Lab
                      </>
                    )}
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingLab ? 'Edit Lab Template' : 'Create Lab Template'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Lab Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Azure Fundamentals" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Lab description..." rows={2} />
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
                  <Label>VM Size</Label>
                  <Select value={form.vm_size} onValueChange={v => setForm({ ...form, vm_size: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Standard_B2s">B2s (2 vCPU, 4 GB)</SelectItem>
                      <SelectItem value="Standard_B2ms">B2ms (2 vCPU, 8 GB)</SelectItem>
                      <SelectItem value="Standard_B4ms">B4ms (4 vCPU, 16 GB)</SelectItem>
                      <SelectItem value="Standard_D2s_v3">D2s v3 (2 vCPU, 8 GB)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration (minutes)</Label>
                  <Input type="number" value={form.duration} onChange={e => setForm({ ...form, duration: Number(e.target.value) })} />
                </div>
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
                    <SelectItem value="active">Active</SelectItem>
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
              <Button onClick={handleSave} disabled={!form.name.trim()}>
                {editingLab ? 'Save Changes' : 'Create Lab'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
