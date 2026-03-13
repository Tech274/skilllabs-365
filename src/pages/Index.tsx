import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import type { VMStatus } from "@/lib/types";
import { Server, Users, Activity, Clock, Globe, Zap, Loader2, AlertTriangle, Cpu, Trash2, Play, Monitor, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/integrations/supabase/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { AiInsightCard } from "@/components/AiInsightCard";

interface QuotaItem {
  name: string;
  currentUsage: number;
  limit: number;
  unit: string;
}

interface VMRow {
  id: string;
  status: string;
  region: string;
  vm_size: string;
  private_ip: string | null;
  idle_minutes: number;
  userName?: string;
  labName?: string;
}

type LabTemplate = Tables<"lab_templates">;

const Index = () => {
  const navigate = useNavigate();
  const [vms, setVms] = useState<VMRow[]>([]);
  const [vmLoading, setVmLoading] = useState(true);
  const [quotas, setQuotas] = useState<Record<string, QuotaItem[]>>({});
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [vmStatusCounts, setVmStatusCounts] = useState<Record<string, number>>({});
  const [purging, setPurging] = useState(false);
  const quotaAlertShown = useRef(false);
  const [labs, setLabs] = useState<LabTemplate[]>([]);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const fetchVMs = useCallback(async () => {
    const { data, error } = await supabase
      .from("virtual_machines")
      .select("*, lab_templates(name), profiles!virtual_machines_user_id_fkey(display_name)")
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      const { data: fallback } = await supabase.from("virtual_machines").select("*").order("created_at", { ascending: false }).limit(8);
      if (fallback) setVms(fallback.map((vm: any) => ({ ...vm, userName: "—", labName: "—" })));
    } else if (data) {
      setVms(data.map((vm: any) => ({
        ...vm,
        userName: vm.profiles?.display_name || "—",
        labName: vm.lab_templates?.name || "—",
      })));
    }
    setVmLoading(false);
  }, []);

  const fetchQuotas = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("azure-quota");
      if (!error && data && !data.error) {
        setQuotas(data.quotas || {});
        setVmStatusCounts(data.vm_status_counts || {});

        // Fire in-app quota alerts (once per page load)
        if (!quotaAlertShown.current) {
          quotaAlertShown.current = true;
          const allQuotas = data.quotas || {};
          for (const [region, items] of Object.entries(allQuotas)) {
            for (const q of items as QuotaItem[]) {
              const pct = q.limit > 0 ? Math.round((q.currentUsage / q.limit) * 100) : 0;
              if (pct >= 95) {
                toast({
                  title: `⚠️ Quota Critical: ${q.name}`,
                  description: `${region} — ${q.currentUsage}/${q.limit} cores used (${pct}%). Students cannot launch new labs. Free up VMs or request a quota increase.`,
                  variant: "destructive",
                });
              } else if (pct >= 80) {
                toast({
                  title: `Quota Warning: ${q.name}`,
                  description: `${region} — ${q.currentUsage}/${q.limit} cores used (${pct}%). Consider cleaning up unused VMs.`,
                });
              }
            }
          }
        }
      }
    } catch { /* silent */ }
    setQuotaLoading(false);
  }, []);

  const handlePurgeFailedVMs = async () => {
    setPurging(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "purge-failed" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Purge Complete",
        description: `${data.count} failed/terminated VM records removed from the database.`,
      });
      fetchVMs();
      fetchQuotas();
    } catch (err: any) {
      toast({ title: "Purge Failed", description: err.message, variant: "destructive" });
    } finally {
      setPurging(false);
    }
  };

  const handleLaunchLab = async (lab: LabTemplate) => {
    setLaunchingId(lab.id);
    try {
      const { data, error } = await supabase.functions.invoke("provision-lab", {
        body: { lab_template_id: lab.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data.status === "running") {
        toast({ title: "VM Ready", description: "Redirecting to your lab session..." });
        navigate(`/labs/session/${lab.id}?vm_id=${data.vm_id}`);
      } else {
        // VM still provisioning — poll for readiness
        toast({ title: "VM Provisioning", description: "Azure VM is starting up. Waiting for it to be ready..." });
        const vmId = data.vm_id;
        const pollInterval = setInterval(async () => {
          try {
            const { data: statusData } = await supabase.functions.invoke("check-vm-status", {
              body: { vm_id: vmId },
            });
            const vmStatus = statusData?.status;
            if (vmStatus === "running") {
              clearInterval(pollInterval);
              toast({ title: "VM Ready", description: "Redirecting to your lab session..." });
              setLaunchingId(null);
              navigate(`/labs/session/${lab.id}?vm_id=${vmId}`);
            } else if (vmStatus === "failed" || vmStatus === "terminated" || vmStatus === "deallocated") {
              clearInterval(pollInterval);
              setLaunchingId(null);
              toast({ title: "Launch Failed", description: `VM entered ${vmStatus} state. Please try again.`, variant: "destructive" });
            }
          } catch {
            // Ignore poll errors, will retry
          }
        }, 10000);
        // Safety timeout after 3 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setLaunchingId(null);
        }, 180000);
        return; // Don't clear launchingId yet
      }
    } catch (err: any) {
      toast({ title: "Launch Failed", description: err.message || "Failed to provision VM.", variant: "destructive" });
    } finally {
      if (launchingId === lab.id) setLaunchingId(null);
    }
  };

  useEffect(() => {
    fetchVMs();
    fetchQuotas();
    supabase.from("lab_templates").select("*").eq("status", "active").order("name").then(({ data }) => {
      if (data) setLabs(data);
    });

    const channel = supabase
      .channel("dashboard-vm-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "virtual_machines" }, () => fetchVMs())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchVMs, fetchQuotas]);

  const totalRunning = vmStatusCounts["running"] || 0;
  const totalIdle = vmStatusCounts["idle"] || 0;
  const totalProvisioning = vmStatusCounts["provisioning"] || 0;
  const totalFailed = vmStatusCounts["failed"] || 0;
  const totalDeallocated = vmStatusCounts["deallocated"] || 0;
  const totalTerminated = vmStatusCounts["terminated"] || 0;
  const purgeableCount = totalFailed + totalTerminated;

  // Check if any quota exceeds 80%
  const hasQuotaAlert = !quotaLoading && Object.values(quotas).some((items) =>
    (items as QuotaItem[]).some((q) => q.limit > 0 && (q.currentUsage / q.limit) * 100 >= 80)
  );

  const statusDistribution = [
    { name: 'Running', value: totalRunning, fill: 'hsl(152 60% 45%)' },
    { name: 'Idle', value: totalIdle, fill: 'hsl(38 90% 55%)' },
    { name: 'Provisioning', value: totalProvisioning, fill: 'hsl(210 80% 55%)' },
    { name: 'Failed', value: totalFailed, fill: 'hsl(0 72% 55%)' },
    { name: 'Deallocated', value: totalDeallocated, fill: 'hsl(215 12% 52%)' },
  ].filter(s => s.value > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Real-time platform overview</p>
          </div>
          {purgeableCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10" disabled={purging}>
                  {purging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Purge Failed VMs ({purgeableCount})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Purge Failed & Terminated VMs</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {purgeableCount} failed/terminated VM records from the database and clean up any remaining Azure resources. This frees up quota for new lab launches.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handlePurgeFailedVMs} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Purge {purgeableCount} VMs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Quota Alert Banner */}
        <AnimatePresence>
          {hasQuotaAlert && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex items-center gap-3"
            >
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning">Azure compute quota is above 80%</p>
                <p className="text-xs text-warning/80 mt-0.5">Students may be unable to launch new labs. Clean up unused VMs or request a quota increase from Azure.</p>
              </div>
              <Link to="/vms">
                <Button variant="outline" size="sm" className="text-warning border-warning/30 hover:bg-warning/10 text-xs">
                  Manage VMs →
                </Button>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI Insights */}
        <AiInsightCard
          type="cost_insight"
          data={{
            vm_counts: vmStatusCounts,
            total_running: totalRunning,
            total_idle: totalIdle,
            total_failed: totalFailed,
            quotas,
          }}
          title="AI Platform Insights"
          buttonLabel="Analyze"
        />

        {/* Quick Launch */}
        {labs.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Play className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Quick Launch</h3>
              <span className="text-[10px] text-muted-foreground ml-1">Test lab provisioning directly</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {labs.map((lab) => (
                <Button
                  key={lab.id}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={launchingId === lab.id}
                  onClick={() => handleLaunchLab(lab)}
                >
                  {launchingId === lab.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : lab.protocol.toUpperCase() === "RDP" ? (
                    <Monitor className="h-3.5 w-3.5" />
                  ) : (
                    <Terminal className="h-3.5 w-3.5" />
                  )}
                  {lab.name}
                  <Badge variant="outline" className="text-[9px] font-mono ml-1">{lab.vm_size}</Badge>
                </Button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricCard title="Active VMs" value={totalRunning + totalIdle} icon={Server} variant="primary" />
          <MetricCard title="Provisioning" value={totalProvisioning} icon={Clock} variant="default" />
          <MetricCard title="Idle VMs" value={totalIdle} icon={Activity} variant="warning" subtitle="Auto-stop in ≤15min" />
          <MetricCard title="Failed" value={totalFailed} icon={AlertTriangle} variant={totalFailed > 0 ? "warning" : "default"} />
          <MetricCard title="Deallocated" value={totalDeallocated} icon={Server} variant="default" />
          <MetricCard title="Regions" value="2/2" icon={Globe} variant="success" subtitle="All healthy" />
        </div>

        {/* Azure Quota Widget + VM Status Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Quota Widget */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Azure Compute Quota</h3>
              {quotaLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {quotaLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Fetching Azure quotas...
              </div>
            ) : Object.keys(quotas).length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                Unable to fetch Azure quotas. Check credentials.
              </div>
            ) : (
              <div className="space-y-5">
                {Object.entries(quotas).map(([region, items]) => (
                  <div key={region}>
                    <div className="flex items-center gap-2 mb-3">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{region}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {items.map((q) => {
                        const pct = q.limit > 0 ? Math.round((q.currentUsage / q.limit) * 100) : 0;
                        const isHigh = pct >= 80;
                        const isCritical = pct >= 95;
                        return (
                          <div key={`${region}-${q.name}`} className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-foreground">{q.name}</span>
                              <span className={`text-xs font-mono font-semibold ${isCritical ? "text-destructive" : isHigh ? "text-warning" : "text-foreground"}`}>
                                {q.currentUsage}/{q.limit}
                              </span>
                            </div>
                            <Progress
                              value={pct}
                              className="h-2"
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">{pct}% used</span>
                              {isCritical && (
                                <span className="text-[10px] text-destructive font-medium flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Quota critical
                                </span>
                              )}
                              {isHigh && !isCritical && (
                                <span className="text-[10px] text-warning font-medium">Nearing limit</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">VM Status</h3>
            {statusDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={statusDistribution} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">
                {quotaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "No VMs"}
              </div>
            )}
          </motion.div>
        </div>

        {/* Region Status — from live VM data */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {['East US', 'Central India'].map((region) => {
            const regionVMs = vms.filter(v => v.region === region);
            const activeCount = regionVMs.filter(v => ['running', 'idle'].includes(v.status)).length;
            return (
              <motion.div key={region} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-medium text-foreground">{region}</h3>
                  </div>
                  <StatusBadge status={activeCount > 0 ? "running" : "stopped"} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'Active VMs', value: activeCount },
                    { label: 'Total VMs', value: regionVMs.length },
                    { label: 'Status', value: activeCount > 0 ? 'Healthy' : 'Idle' },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg bg-muted/50 p-2">
                      <p className="text-lg font-mono font-semibold text-foreground">{m.value}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Recent VMs Table — Live Data */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Recent Virtual Machines</h3>
            <Link to="/vms" className="text-xs text-primary hover:underline">View All →</Link>
          </div>
          {vmLoading ? (
            <div className="p-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['VM ID', 'User', 'Lab', 'Region', 'IP', 'Size', 'Status', 'Idle'].map((h) => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vms.map((vm) => (
                    <tr key={vm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-primary">
                        <Link to={`/vms/${vm.id}`} className="hover:underline">{vm.id.slice(0, 8)}…</Link>
                      </td>
                      <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.region}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.private_ip || "—"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.vm_size}</td>
                      <td className="px-5 py-3"><StatusBadge status={vm.status as VMStatus} /></td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.idle_minutes > 0 ? `${vm.idle_minutes}m` : '—'}</td>
                    </tr>
                  ))}
                  {vms.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center">
                        <Server className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">No Virtual Machines</p>
                        <p className="text-xs text-muted-foreground mt-1">Launch a lab to see VMs appear here in real-time.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
