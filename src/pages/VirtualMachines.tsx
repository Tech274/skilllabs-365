import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { labVMs } from "@/lib/mock-data";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, RotateCcw, StopCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VMStatus } from "@/lib/mock-data";
import { motion } from "framer-motion";

export default function VirtualMachines() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = labVMs.filter(vm => {
    const matchSearch = vm.id.includes(search) || vm.userName.toLowerCase().includes(search.toLowerCase()) || vm.labName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || vm.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Virtual Machines</h1>
            <p className="text-sm text-muted-foreground mt-1">{labVMs.length} total VMs across all regions</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search VMs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-card" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="provisioning">Provisioning</SelectItem>
              <SelectItem value="starting">Starting</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
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
                    <td className="px-5 py-3 font-mono text-xs text-primary">{vm.id}</td>
                    <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.region}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.privateIp}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.vmSize}</td>
                    <td className="px-5 py-3"><StatusBadge status={vm.status} /></td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.idleMinutes > 0 ? `${vm.idleMinutes}m` : '—'}</td>
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
          {filtered.length === 0 && (
            <div className="p-12 text-center text-muted-foreground text-sm">No VMs match your filters.</div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
