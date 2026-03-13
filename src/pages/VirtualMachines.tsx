import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { Search, RotateCcw, StopCircle, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { VMStatus } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface VMRow {
  id: string;
  user_id: string | null;
  region: string;
  private_ip: string | null;
  vm_size: string;
  status: string;
  idle_minutes: number;
  azure_vm_id: string | null;
  lab_template_id: string | null;
  created_at: string;
  expires_at: string | null;
  userName?: string;
  labName?: string;
}

export default function VirtualMachines() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vms, setVms] = useState<VMRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVMs = async () => {
    setLoading(true);
    const { data: vmData, error } = await supabase
      .from("virtual_machines")
      .select("*, lab_templates(name), profiles!virtual_machines_user_id_fkey(display_name)")
      .order("created_at", { ascending: false });

    if (error) {
      // Fallback: fetch without joins if FK relationship isn't recognized
      const { data: fallbackData } = await supabase
        .from("virtual_machines")
        .select("*")
        .order("created_at", { ascending: false });

      if (fallbackData) {
        setVms(fallbackData.map((vm: any) => ({ ...vm, userName: "—", labName: "—" })));
      }
    } else if (vmData) {
      setVms(vmData.map((vm: any) => ({
        ...vm,
        userName: vm.profiles?.display_name || "—",
        labName: vm.lab_templates?.name || "—",
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchVMs();

    // Realtime subscription for instant status updates
    const channel = supabase
      .channel("vm-status-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "virtual_machines" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setVms((prev) =>
              prev.map((vm) =>
                vm.id === (payload.new as any).id
                  ? { ...vm, ...(payload.new as any) }
                  : vm
              )
            );
          } else if (payload.eventType === "INSERT") {
            // Refetch to get joined data
            fetchVMs();
          } else if (payload.eventType === "DELETE") {
            setVms((prev) => prev.filter((vm) => vm.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = vms.filter(vm => {
    const matchSearch =
      vm.id.toLowerCase().includes(search.toLowerCase()) ||
      (vm.userName || "").toLowerCase().includes(search.toLowerCase()) ||
      (vm.labName || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || vm.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const allStatuses: VMStatus[] = ['running', 'idle', 'provisioning', 'starting', 'expired', 'stopped', 'deallocated', 'terminated', 'failed'];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Virtual Machines</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {vms.length} total VMs across all regions
              <span className="ml-2 inline-flex items-center gap-1 text-success text-[10px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live
              </span>
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchVMs}>
            <RotateCcw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search VMs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-card" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {allStatuses.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
          {loading ? (
            <div className="p-12 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading VMs...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['VM ID', 'User', 'Lab', 'Region', 'Private IP', 'Size', 'Status', 'Idle', 'Actions'].map(h => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(vm => (
                    <tr key={vm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-primary">
                        <Link to={`/vms/${vm.id}`} className="hover:underline flex items-center gap-1">
                          {vm.id.slice(0, 8)}…
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.region}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.private_ip || "—"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.vm_size}</td>
                      <td className="px-5 py-3"><StatusBadge status={vm.status as VMStatus} /></td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.idle_minutes > 0 ? `${vm.idle_minutes}m` : '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1">
                          <button className="p-1.5 rounded hover:bg-warning/10 text-warning transition-colors" title="Stop"><StopCircle className="h-3.5 w-3.5" /></button>
                          <button className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-12 text-center text-muted-foreground text-sm">No VMs match your filters.</div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
