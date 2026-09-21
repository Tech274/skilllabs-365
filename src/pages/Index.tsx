import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import type { VMStatus } from "@/lib/types";
import { Server, Activity, Clock, Globe, Loader2, AlertTriangle, Cpu, Trash2, Monitor } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/function-error";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
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
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { NetworkHealthPanel } from "@/components/NetworkHealthPanel";


/** Extract VM / instance name from azure_vm_id (full ARM path or bare name). */
function extractInstanceName(azureVmId: string | null | undefined): string | null {
  if (!azureVmId) return null;
  const trimmed = azureVmId.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").filter(Boolean);
    return parts[parts.length - 1] || trimmed;
  }
  return trimmed;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  created_at?: string;
  azure_vm_id?: string | null;
  lab_template_id?: string | null;
  userName?: string;
  labName?: string;
  instanceName?: string | null;
  cloud?: string;
}


const Index = () => {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [vms, setVms] = useState<VMRow[]>([]);
  const [vmLoading, setVmLoading] = useState(true);
  const [quotas, setQuotas] = useState<Record<string, QuotaItem[]>>({});
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [vmStatusCounts, setVmStatusCounts] = useState<Record<string, number>>({});
  const [purging, setPurging] = useState(false);
  const quotaAlertShown = useRef(false);

  const fetchVMs = useCallback(async () => {
    // No virtual_machines → profiles FK; resolve display names via profiles batch
    // (same source as Sessions actor / User Administration).
    const { data, error } = await supabase
      .from("virtual_machines")
      .select("*, lab_templates(name)")
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      console.error("Failed to load overview VMs:", error.message);
      setVms([]);
      setVmLoading(false);
      return;
    }

    if (data) {
      const userIds = Array.from(
        new Set(data.map((vm: any) => vm.user_id).filter(Boolean)),
      ) as string[];
      const profileMap = new Map<string, { display_name: string; email: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", userIds);
        for (const p of profiles ?? []) {
          profileMap.set(p.user_id, { display_name: p.display_name, email: p.email });
        }
      }

      setVms(data.map((vm: any) => {
        const azureId = vm.azure_vm_id as string | null;
        let cloud = "—";
        if (azureId) {
          if (azureId.includes("/subscriptions/") || azureId.toLowerCase().includes("microsoft")) cloud = "Azure";
          else if (azureId.startsWith("i-") || azureId.startsWith("arn:")) cloud = "AWS";
          else cloud = "Cloud";
        }
        const profile = vm.user_id ? profileMap.get(vm.user_id) : undefined;
        return {
          ...vm,
          userName: profile?.display_name || profile?.email || "—",
          labName: vm.lab_templates?.name || "—",
          instanceName: extractInstanceName(azureId) || vm.lab_templates?.name || null,
          cloud,
        };
      }));
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
      if (error || data?.error) throw new Error(await readFunctionError(error, data));
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


  useEffect(() => {
    fetchVMs();
    fetchQuotas();

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
  const totalStopped = vmStatusCounts["stopped"] || 0;
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
    { name: 'Stopped', value: totalStopped, fill: 'hsl(215 16% 47%)' },
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

        {/* Gateway host OK (not Connect) — Host & TLS landing-page probes only */}
        <NetworkHealthPanel />

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricCard title="Active VMs" value={totalRunning + totalIdle} icon={Server} variant="primary" to="/vms?status=active" />
          <MetricCard title="Provisioning" value={totalProvisioning} icon={Clock} variant="default" to="/vms?status=provisioning" />
          <MetricCard title="Idle VMs" value={totalIdle} icon={Activity} variant="warning" subtitle="Auto-stop in ≤15min" to="/vms?status=idle" />
          <MetricCard title="Stopped" value={totalStopped} icon={Server} variant="default" to="/vms?status=stopped" />
          <MetricCard title="Failed" value={totalFailed} icon={AlertTriangle} variant={totalFailed > 0 ? "warning" : "default"} to="/vms?status=failed" />
          <MetricCard title="Deallocated" value={totalDeallocated} icon={Server} variant="default" to="/vms?status=deallocated" />
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


        {/* Recent allocations — plain instance names, no /vms/:id links */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Recent Allocations</h3>
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
                    {['Username', 'Instance', 'Status', 'Created', 'Cloud', 'Lab', 'Actions'].map((h) => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vms.map((vm) => (
                    <tr key={vm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                      <td className="px-5 py-3 font-mono text-xs text-foreground">{vm.instanceName || "—"}</td>
                      <td className="px-5 py-3"><StatusBadge status={vm.status as VMStatus} /></td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(vm.created_at)}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{vm.cloud || "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                      <td className="px-5 py-3">
                        {(isSuperAdmin || ["running", "idle"].includes(vm.status)) && (
                          <UiTooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"
                                title={isSuperAdmin ? "Admin Connect (barge-in)" : "Connect (admin)"}
                                onClick={() =>
                                  navigate(
                                    `/labs/session/${vm.lab_template_id || vm.id}?vm_id=${vm.id}${isSuperAdmin ? "&admin=1" : ""}`,
                                  )
                                }
                              >
                                <Monitor className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isSuperAdmin
                                ? ["running", "idle"].includes(vm.status)
                                  ? "Admin Connect (barge-in)"
                                  : "Admin Connect — start machine first"
                                : "Connect (admin)"}
                            </TooltipContent>
                          </UiTooltip>
                        )}
                      </td>
                    </tr>
                  ))}
                  {vms.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center">
                        <Server className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">No Virtual Machines</p>
                        <p className="text-xs text-muted-foreground mt-1">Launch a lab to see allocations appear here in real-time.</p>
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
