import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Monitor, Terminal, Clock, Users, Copy, MoreVertical, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

interface LabTemplate {
  id: string;
  name: string;
  description: string;
  protocol: 'RDP' | 'SSH';
  vmSize: string;
  osImage: string;
  duration: number;
  idleTimeout: number;
  clipboardEnabled: boolean;
  fileTransferEnabled: boolean;
  region: string;
  status: 'active' | 'draft' | 'archived';
  activeSessions: number;
  totalUsage: number;
}

const initialLabs: LabTemplate[] = [
  {
    id: 'lab-1', name: 'Azure Fundamentals', description: 'Introduction to Azure services, portal navigation, and resource management.',
    protocol: 'RDP', vmSize: 'Standard_B2s', osImage: 'Windows Server 2022', duration: 120, idleTimeout: 20,
    clipboardEnabled: true, fileTransferEnabled: false, region: 'All Regions', status: 'active', activeSessions: 128, totalUsage: 4520,
  },
  {
    id: 'lab-2', name: 'Kubernetes Lab', description: 'Hands-on AKS deployment, pod management, and Helm chart exercises.',
    protocol: 'SSH', vmSize: 'Standard_B2ms', osImage: 'Ubuntu 22.04 LTS', duration: 180, idleTimeout: 20,
    clipboardEnabled: true, fileTransferEnabled: true, region: 'All Regions', status: 'active', activeSessions: 95, totalUsage: 3210,
  },
  {
    id: 'lab-3', name: 'DevOps Pipeline', description: 'CI/CD pipeline setup with Azure DevOps, GitHub Actions, and Terraform.',
    protocol: 'SSH', vmSize: 'Standard_B4ms', osImage: 'Ubuntu 22.04 LTS', duration: 240, idleTimeout: 20,
    clipboardEnabled: true, fileTransferEnabled: true, region: 'East US', status: 'active', activeSessions: 67, totalUsage: 2890,
  },
  {
    id: 'lab-4', name: 'Security Workshop', description: 'Network security groups, Azure Firewall, and Key Vault integration.',
    protocol: 'RDP', vmSize: 'Standard_D2s_v3', osImage: 'Windows Server 2022', duration: 150, idleTimeout: 15,
    clipboardEnabled: false, fileTransferEnabled: false, region: 'All Regions', status: 'active', activeSessions: 42, totalUsage: 1560,
  },
  {
    id: 'lab-5', name: 'Networking Lab', description: 'VNet peering, load balancers, Application Gateway, and DNS configuration.',
    protocol: 'RDP', vmSize: 'Standard_B2s', osImage: 'Windows Server 2022', duration: 120, idleTimeout: 20,
    clipboardEnabled: true, fileTransferEnabled: false, region: 'Central India', status: 'draft', activeSessions: 0, totalUsage: 890,
  },
  {
    id: 'lab-6', name: 'Linux Administration', description: 'System administration, shell scripting, and service management on Ubuntu.',
    protocol: 'SSH', vmSize: 'Standard_B2s', osImage: 'Ubuntu 22.04 LTS', duration: 90, idleTimeout: 20,
    clipboardEnabled: true, fileTransferEnabled: true, region: 'All Regions', status: 'archived', activeSessions: 0, totalUsage: 6320,
  },
];

const emptyLab: Omit<LabTemplate, 'id' | 'activeSessions' | 'totalUsage'> = {
  name: '', description: '', protocol: 'RDP', vmSize: 'Standard_B2s', osImage: 'Windows Server 2022',
  duration: 120, idleTimeout: 20, clipboardEnabled: true, fileTransferEnabled: false, region: 'All Regions', status: 'draft',
};

const statusStyle = {
  active: 'bg-success/10 text-success',
  draft: 'bg-warning/10 text-warning',
  archived: 'bg-muted text-muted-foreground',
};

export default function LabManagement() {
  const navigate = useNavigate();
  const [labs, setLabs] = useState(initialLabs);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLab, setEditingLab] = useState<LabTemplate | null>(null);
  const [form, setForm] = useState(emptyLab);

  const openCreate = () => {
    setEditingLab(null);
    setForm(emptyLab);
    setDialogOpen(true);
  };

  const openEdit = (lab: LabTemplate) => {
    setEditingLab(lab);
    setForm({ name: lab.name, description: lab.description, protocol: lab.protocol, vmSize: lab.vmSize, osImage: lab.osImage, duration: lab.duration, idleTimeout: lab.idleTimeout, clipboardEnabled: lab.clipboardEnabled, fileTransferEnabled: lab.fileTransferEnabled, region: lab.region, status: lab.status });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editingLab) {
      setLabs(prev => prev.map(l => l.id === editingLab.id ? { ...l, ...form } : l));
      toast({ title: "Lab updated", description: `${form.name} has been updated.` });
    } else {
      const newLab: LabTemplate = {
        ...form, id: `lab-${Date.now()}`, activeSessions: 0, totalUsage: 0,
      };
      setLabs(prev => [newLab, ...prev]);
      toast({ title: "Lab created", description: `${form.name} has been created.` });
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    const lab = labs.find(l => l.id === id);
    setLabs(prev => prev.filter(l => l.id !== id));
    toast({ title: "Lab deleted", description: `${lab?.name} has been removed.` });
  };

  const handleDuplicate = (lab: LabTemplate) => {
    const dup: LabTemplate = { ...lab, id: `lab-${Date.now()}`, name: `${lab.name} (Copy)`, status: 'draft', activeSessions: 0 };
    setLabs(prev => [dup, ...prev]);
    toast({ title: "Lab duplicated", description: `${dup.name} created as draft.` });
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

        {/* Lab Cards Grid */}
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
                  {lab.protocol === 'RDP' ? <Monitor className="h-4 w-4 text-primary" /> : <Terminal className="h-4 w-4 text-success" />}
                  <h3 className="text-sm font-semibold text-foreground">{lab.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", statusStyle[lab.status])}>
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

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-sm font-mono font-semibold text-foreground">{lab.duration}m</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Duration</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-sm font-mono font-semibold text-foreground">{lab.activeSessions}</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Active</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-sm font-mono font-semibold text-foreground">{lab.totalUsage.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Total</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px] font-mono">{lab.vmSize}</Badge>
                <Badge variant="outline" className="text-[10px]">{lab.protocol}</Badge>
                <Badge variant="outline" className="text-[10px]">{lab.region}</Badge>
                {!lab.clipboardEnabled && <Badge variant="outline" className="text-[10px] text-warning border-warning/30">No Clipboard</Badge>}
              </div>
            </motion.div>
          ))}
        </div>

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
                  <Select value={form.protocol} onValueChange={v => setForm({ ...form, protocol: v as 'RDP' | 'SSH', osImage: v === 'RDP' ? 'Windows Server 2022' : 'Ubuntu 22.04 LTS' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RDP">RDP (Windows)</SelectItem>
                      <SelectItem value="SSH">SSH (Linux)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>VM Size</Label>
                  <Select value={form.vmSize} onValueChange={v => setForm({ ...form, vmSize: v })}>
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
                  <Input type="number" value={form.idleTimeout} onChange={e => setForm({ ...form, idleTimeout: Number(e.target.value) })} />
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
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as 'active' | 'draft' | 'archived' })}>
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
                <Switch checked={form.clipboardEnabled} onCheckedChange={v => setForm({ ...form, clipboardEnabled: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <div>
                  <p className="text-sm text-foreground">File Transfer</p>
                  <p className="text-xs text-muted-foreground">Allow file upload/download</p>
                </div>
                <Switch checked={form.fileTransferEnabled} onCheckedChange={v => setForm({ ...form, fileTransferEnabled: v })} />
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
