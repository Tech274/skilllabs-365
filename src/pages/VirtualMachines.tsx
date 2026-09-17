import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  RotateCcw,
  StopCircle,
  Trash2,
  ExternalLink,
  Loader2,
  CheckSquare,
  X,
  Server,
  Play,
  RefreshCw,
  Info,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { VMStatus } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  provider_account_id: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  participantName?: string;
  labName?: string;
  labAccountName?: string;
  labAccountProvider?: string | null;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function VirtualMachines() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vms, setVms] = useState<VMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const fetchVMs = useCallback(async () => {
    setLoading(true);
    const { data: vmData, error } = await supabase
      .from("virtual_machines")
      .select(
        "*, lab_templates(name), profiles!virtual_machines_user_id_fkey(display_name), cloud_provider_accounts(display_name, provider, slug)",
      )
      .order("created_at", { ascending: false });

    if (error) {
      const { data: fallbackData } = await supabase
        .from("virtual_machines")
        .select("*")
        .order("created_at", { ascending: false });

      if (fallbackData) {
        setVms(
          fallbackData.map((vm: VMRow) => ({
            ...vm,
            participantName: "—",
            labName: "—",
            labAccountName: "—",
            labAccountProvider: null,
          })),
        );
      }
    } else if (vmData) {
      setVms(
        vmData.map((vm: Record<string, unknown>) => {
          const profiles = vm.profiles as { display_name?: string } | null;
          const labs = vm.lab_templates as { name?: string } | null;
          const account = vm.cloud_provider_accounts as {
            display_name?: string;
            provider?: string;
            slug?: string;
          } | null;
          return {
            ...(vm as unknown as VMRow),
            participantName: profiles?.display_name || "—",
            labName: labs?.name || "—",
            labAccountName: account?.display_name || "—",
            labAccountProvider: account?.provider ?? null,
          };
        }),
      );
    }
    setLoading(false);
  }, []);

  const handleStopVM = async (vmId: string) => {
    setActionLoading(vmId);
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "stop-vm", vm_id: vmId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "VM Stopped", description: `Machine ${vmId.slice(0, 8)}… is being deallocated.` });
    } catch (err: unknown) {
      toast({
        title: "Failed to stop VM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteVM = async (vmId: string) => {
    setActionLoading(vmId);
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "delete-vm", vm_id: vmId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "VM Deleted",
        description: `Machine ${vmId.slice(0, 8)}… has been terminated.`,
        variant: "destructive",
      });
    } catch (err: unknown) {
      toast({
        title: "Failed to delete VM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkStop = async () => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    let stopped = 0;
    for (const vmId of ids) {
      try {
        const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "stop-vm", vm_id: vmId },
        });
        if (!error && !data?.error) stopped++;
      } catch {
        /* continue */
      }
    }
    toast({ title: "Bulk Stop Complete", description: `${stopped} of ${ids.length} VMs deallocated.` });
    setSelectedIds(new Set());
    setBulkLoading(false);
  };

  const handleBulkDelete = async () => {
    setBulkLoading(true);
    setShowBulkDeleteConfirm(false);
    const ids = Array.from(selectedIds);
    let deleted = 0;
    for (const vmId of ids) {
      try {
        const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "delete-vm", vm_id: vmId },
        });
        if (!error && !data?.error) deleted++;
      } catch {
        /* continue */
      }
    }
    toast({
      title: "Bulk Delete Complete",
      description: `${deleted} of ${ids.length} VMs terminated.`,
      variant: "destructive",
    });
    setSelectedIds(new Set());
    setBulkLoading(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((vm) => vm.id)));
    }
  };

  useEffect(() => {
    fetchVMs();

    const channel = supabase
      .channel("vm-status-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "virtual_machines" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setVms((prev) =>
              prev.map((vm) =>
                vm.id === (payload.new as VMRow).id ? { ...vm, ...(payload.new as VMRow) } : vm,
              ),
            );
          } else if (payload.eventType === "INSERT") {
            fetchVMs();
          } else if (payload.eventType === "DELETE") {
            setVms((prev) => prev.filter((vm) => vm.id !== (payload.old as VMRow).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchVMs]);

  const filtered = vms.filter((vm) => {
    const q = search.toLowerCase();
    const matchSearch =
      vm.id.toLowerCase().includes(q) ||
      (vm.participantName || "").toLowerCase().includes(q) ||
      (vm.labName || "").toLowerCase().includes(q) ||
      (vm.labAccountName || "").toLowerCase().includes(q) ||
      (vm.azure_vm_id || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || vm.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const allStatuses: VMStatus[] = [
    "running",
    "idle",
    "provisioning",
    "starting",
    "expired",
    "stopped",
    "deallocated",
    "terminated",
    "failed",
  ];
  const isActiveStatus = (s: string) => ["running", "idle", "provisioning", "starting"].includes(s);
  const hasSelection = selectedIds.size > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Virtual Machines</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Fleet view — {vms.length} machine{vms.length === 1 ? "" : "s"}
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

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p>
              <span className="font-medium text-foreground">Heartbeat</span> uses{" "}
              <code className="text-[10px]">virtual_machines.updated_at</code> (no dedicated{" "}
              <code className="text-[10px]">heartbeat_at</code> field yet).
            </p>
            <p>
              <span className="font-medium text-foreground">Start / Reset</span> are shown for parity with
              Orchestrator fleet clarity but are disabled —{" "}
              <code className="text-[10px]">cleanup-idle-labs</code> currently exposes stop/delete only
              (no <code className="text-[10px]">start-vm</code> / <code className="text-[10px]">reset-vm</code>).
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search machine, participant, lab, account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {allStatuses.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AnimatePresence>
          {hasSelection && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
            >
              <CheckSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} machine{selectedIds.size > 1 ? "s" : ""} selected
              </span>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-warning border-warning/30 hover:bg-warning/10"
                disabled={bulkLoading}
                onClick={handleBulkStop}
              >
                {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
                Stop All
              </Button>
              <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={bulkLoading}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} Virtual Machines</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently terminate {selectedIds.size} machine
                      {selectedIds.size > 1 ? "s" : ""} and delete their cloud resources. This action cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleBulkDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete {selectedIds.size} machines
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-border bg-card overflow-hidden"
        >
          {loading ? (
            <div className="p-12 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading fleet…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-3 w-10">
                      <Checkbox
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </th>
                    {[
                      "Machine",
                      "Lab account",
                      "Status",
                      "Heartbeat",
                      "Participant",
                      "Lab",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((vm) => (
                    <tr
                      key={vm.id}
                      className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                        selectedIds.has(vm.id) ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-3 py-3">
                        <Checkbox
                          checked={selectedIds.has(vm.id)}
                          onCheckedChange={() => toggleSelect(vm.id)}
                          aria-label={`Select machine ${vm.id.slice(0, 8)}`}
                        />
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          to={`/vms/${vm.id}`}
                          className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {vm.id.slice(0, 8)}…
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                          {vm.vm_size} · {vm.region}
                          {vm.private_ip ? ` · ${vm.private_ip}` : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-foreground text-sm">{vm.labAccountName}</div>
                        {vm.labAccountProvider && (
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {vm.labAccountProvider}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={vm.status as VMStatus} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatRelative(vm.updated_at)}
                        </div>
                        {vm.idle_minutes > 0 && (
                          <div className="text-[10px] text-muted-foreground">Idle {vm.idle_minutes}m</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-foreground">{vm.participantName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="p-1.5 rounded text-muted-foreground/50 cursor-not-allowed"
                                title="Start"
                                disabled
                                aria-disabled
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Start not available — backend has no start-vm action yet
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="p-1.5 rounded hover:bg-warning/10 text-warning transition-colors disabled:opacity-40"
                                title="Stop"
                                disabled={!isActiveStatus(vm.status) || actionLoading === vm.id}
                                onClick={() => handleStopVM(vm.id)}
                              >
                                {actionLoading === vm.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <StopCircle className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Stop / deallocate</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="p-1.5 rounded text-muted-foreground/50 cursor-not-allowed"
                                title="Reset"
                                disabled
                                aria-disabled
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Reset not available — backend has no reset-vm action yet
                            </TooltipContent>
                          </Tooltip>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-40"
                                title="Delete"
                                disabled={actionLoading === vm.id}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Virtual Machine</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently terminate machine{" "}
                                  <span className="font-mono">{vm.id.slice(0, 8)}…</span> and delete its cloud
                                  resources. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteVM(vm.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete machine
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && vms.length === 0 && (
            <div className="p-16 flex flex-col items-center justify-center text-center">
              <Server className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No Virtual Machines</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                No VMs have been provisioned yet. Launch a lab from the Student Dashboard to see machines appear
                here in real-time.
              </p>
            </div>
          )}
          {!loading && vms.length > 0 && filtered.length === 0 && (
            <div className="p-12 text-center text-muted-foreground text-sm">No machines match your filters.</div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
