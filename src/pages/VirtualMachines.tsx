import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  RotateCcw,
  StopCircle,
  Trash2,
  Loader2,
  CheckSquare,
  X,
  Server,
  Info,
  Monitor,
  Play,
} from "lucide-react";
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
import { useAuth } from "@/hooks/use-auth";

interface VMRow {
  id: string;
  user_id: string | null;
  region: string;
  private_ip: string | null;
  vm_size: string;
  status: string;
  idle_minutes: number;
  azure_vm_id: string | null;
  provider?: string | null;
  lab_template_id: string | null;
  provider_account_id: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  assigneeName?: string;
  assigneeEmail?: string | null;
  labUsername?: string | null;
  instanceName?: string | null;
  labName?: string | null;
}

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

export default function VirtualMachines() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vms, setVms] = useState<VMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("");
  const [deleteConfirmVmId, setDeleteConfirmVmId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Honor Overview KPI deep-links: /vms?status=running|idle|active|...
  useEffect(() => {
    const raw = searchParams.get("status");
    if (!raw) return;
    const normalized = raw.trim().toLowerCase();
    if (normalized) setStatusFilter(normalized);
  }, [searchParams]);

  const statusPollInFlight = useRef(false);
  const provisioningIdsKey = useMemo(
    () =>
      vms
        .filter((vm) => vm.status === "provisioning")
        .map((vm) => vm.id)
        .sort()
        .join(","),
    [vms],
  );

  const fetchVMs = useCallback(async () => {
    setLoading(true);
    const { data: vmData, error } = await supabase
      .from("virtual_machines")
      .select(
        "*, lab_templates(name), profiles!virtual_machines_user_id_fkey(display_name, email)",
      )
      .order("created_at", { ascending: false });

    let rows: VMRow[] = [];

    if (error) {
      const { data: fallbackData } = await supabase
        .from("virtual_machines")
        .select("*")
        .order("created_at", { ascending: false });

      if (fallbackData) {
        rows = fallbackData.map((vm: VMRow) => ({
          ...vm,
          assigneeName: "—",
          assigneeEmail: null,
          labUsername: null,
          instanceName: extractInstanceName(vm.azure_vm_id),
          labName: null,
        }));
      }
    } else if (vmData) {
      rows = vmData.map((vm: Record<string, unknown>) => {
        const profiles = vm.profiles as { display_name?: string; email?: string | null } | null;
        const labs = vm.lab_templates as { name?: string } | null;
        const azureVmId = (vm.azure_vm_id as string | null) ?? null;
        return {
          ...(vm as unknown as VMRow),
          assigneeName: profiles?.display_name || "—",
          assigneeEmail: profiles?.email ?? null,
          labUsername: null,
          instanceName: extractInstanceName(azureVmId),
          labName: labs?.name || null,
        };
      });
    }

    // Lab username: latest sessions.guac_username per vm_id (no dedicated lab_username on VMs).
    if (rows.length > 0) {
      const vmIds = rows.map((r) => r.id);
      const { data: sessionRows } = await supabase
        .from("sessions")
        .select("vm_id, guac_username, started_at")
        .in("vm_id", vmIds)
        .not("guac_username", "is", null)
        .order("started_at", { ascending: false });

      if (sessionRows && sessionRows.length > 0) {
        const latestByVm = new Map<string, string>();
        for (const s of sessionRows) {
          if (!s.vm_id || !s.guac_username) continue;
          if (!latestByVm.has(s.vm_id)) {
            latestByVm.set(s.vm_id, s.guac_username);
          }
        }
        rows = rows.map((r) => ({
          ...r,
          labUsername: latestByVm.get(r.id) ?? null,
        }));
      }
    }

    setVms(rows);
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
      setVms((prev) => prev.map((vm) => (vm.id === vmId ? { ...vm, status: "deallocated" } : vm)));
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

  /** Admin Start: resume the SAME Stopped/Deallocated allocation (never provision new). */
  const handleStartVM = async (vm: VMRow) => {
    setActionLoading(vm.id);
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "start-vm", vm_id: vm.id, reason: "admin_start" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "VM Starting",
        description: `Machine ${vm.instanceName || vm.id.slice(0, 8)}… is powering on (same allocation).`,
      });
      setVms((prev) => prev.map((row) => (row.id === vm.id ? { ...row, status: "starting" } : row)));
    } catch (err: unknown) {
      toast({
        title: "Failed to start VM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteVM = async (vmId: string, reason = "admin_delete") => {
    setActionLoading(vmId);
    setDeleteConfirmVmId(null);
    setDeleteConfirmText("");
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "delete-vm", vm_id: vmId, reason },
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
    setBulkDeleteConfirmText("");
    const ids = Array.from(selectedIds);
    let deleted = 0;
    for (const vmId of ids) {
      try {
        const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "delete-vm", vm_id: vmId, reason: "admin_delete" },
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
            const next = payload.new as VMRow;
            setVms((prev) =>
              prev.map((vm) =>
                vm.id === next.id
                  ? {
                      ...vm,
                      ...next,
                      instanceName: extractInstanceName(next.azure_vm_id ?? vm.azure_vm_id),
                    }
                  : vm,
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

  // Admin Allocation does not use learner use-provisioning — poll check-vm-status
  // for rows still in provisioning so Azure Running flips Hub status to running.
  // Throttled: at most one wave every 15s, sequential invokes, max 8 per wave.
  useEffect(() => {
    if (!provisioningIdsKey) return;

    const POLL_MS = 15_000;
    const MAX_PER_WAVE = 8;
    const provisioningIds = provisioningIdsKey.split(",").filter(Boolean).slice(0, MAX_PER_WAVE);

    const pollProvisioning = async () => {
      if (statusPollInFlight.current) return;
      statusPollInFlight.current = true;
      try {
        for (const vmId of provisioningIds) {
          try {
            const { data } = await supabase.functions.invoke("check-vm-status", {
              body: { vm_id: vmId },
            });
            const nextStatus = data?.status as string | undefined;
            if (!nextStatus || nextStatus === "provisioning") continue;
            setVms((prev) =>
              prev.map((vm) =>
                vm.id === vmId
                  ? {
                      ...vm,
                      status: nextStatus,
                      private_ip: data?.private_ip ?? vm.private_ip,
                    }
                  : vm,
              ),
            );
          } catch {
            // Ignore individual poll errors; next wave retries.
          }
        }
      } finally {
        statusPollInFlight.current = false;
      }
    };

    void pollProvisioning();
    const timer = window.setInterval(() => {
      void pollProvisioning();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [provisioningIdsKey]);

  const filtered = vms.filter((vm) => {
    const q = search.toLowerCase();
    const matchSearch =
      vm.id.toLowerCase().includes(q) ||
      (vm.assigneeName || "").toLowerCase().includes(q) ||
      (vm.assigneeEmail || "").toLowerCase().includes(q) ||
      (vm.labUsername || "").toLowerCase().includes(q) ||
      (vm.instanceName || "").toLowerCase().includes(q) ||
      (vm.labName || "").toLowerCase().includes(q) ||
      (vm.azure_vm_id || "").toLowerCase().includes(q);
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && ["running", "idle"].includes(vm.status)) ||
      vm.status === statusFilter;
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
  const isResumableStatus = (s: string) => ["stopped", "deallocated"].includes(s);
  const hasSelection = selectedIds.size > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Virtual Machines</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Allocation status — {vms.length} machine{vms.length === 1 ? "" : "s"}
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
              <span className="font-medium text-foreground">Allocation view</span> — assignee, lab
              username, instance name, status, start, and end from Hub data (not Orchestrator fleet
              theater).
            </p>
            <p>
              <span className="font-medium text-foreground">Lab username</span> comes from the latest{" "}
              <code className="text-[10px]">sessions.guac_username</code> for the VM when present;
              otherwise “—”. No dedicated <code className="text-[10px]">lab_username</code> column on{" "}
              <code className="text-[10px]">virtual_machines</code> yet.
            </p>
            <p>
              Actions: <span className="font-medium text-foreground">Connect / Start / Stop / Delete</span>{" "}
              via <code className="text-[10px]">cleanup-idle-labs</code>. Start resumes the same
              Stopped/Deallocated allocation (never provisions a new machine). Soft Stop deallocates
              only — it never purges.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assignee, lab user, instance…"
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
              <SelectItem value="active">Active (running + idle)</SelectItem>
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
              <AlertDialog
                open={showBulkDeleteConfirm}
                onOpenChange={(open) => {
                  setShowBulkDeleteConfirm(open);
                  if (!open) setBulkDeleteConfirmText("");
                }}
              >
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
                      undone. Type <span className="font-mono font-semibold text-foreground">DELETE</span> to
                      confirm.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    value={bulkDeleteConfirmText}
                    onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                    placeholder='Type DELETE to confirm'
                    className="font-mono"
                    autoComplete="off"
                    aria-label="Type DELETE to confirm bulk delete"
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleBulkDelete}
                      disabled={bulkDeleteConfirmText !== "DELETE"}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40"
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
              <Loader2 className="h-4 w-4 animate-spin" /> Loading allocations…
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
                    {["Assignee", "Lab username", "Instance / VM name", "Status", "Start", "End", "Actions"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ),
                    )}
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
                        <div className="text-foreground text-sm">{vm.assigneeName || "—"}</div>
                        {vm.assigneeEmail && (
                          <div className="text-[10px] text-muted-foreground">{vm.assigneeEmail}</div>
                        )}
                        {vm.labName && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">{vm.labName}</div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {vm.labUsername ? (
                          <span className="font-mono text-xs text-foreground">{vm.labUsername}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {vm.instanceName ? (
                          <div>
                            <span className="font-mono text-xs text-foreground">
                              {vm.instanceName}
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {vm.vm_size} · {vm.region}
                              {vm.private_ip ? ` · ${vm.private_ip}` : ""}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono text-xs text-muted-foreground">
                              {vm.id.slice(0, 8)}…
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">No azure_vm_id yet</div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={vm.status as VMStatus} />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(vm.created_at)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(vm.expires_at)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1">
                          {isResumableStatus(vm.status) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="p-1.5 rounded hover:bg-success/10 text-success transition-colors disabled:opacity-40"
                                  title="Start (resume same VM)"
                                  disabled={actionLoading === vm.id || !vm.azure_vm_id}
                                  onClick={() => handleStartVM(vm)}
                                >
                                  {actionLoading === vm.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Start — resume same allocation (no new VM)</TooltipContent>
                            </Tooltip>
                          )}
                          {/* Admin Connect barge on Running/Idle; Super Admin always visible.
                              Learner Connect UX is untouched. */}
                          {(isSuperAdmin || ["running", "idle"].includes(vm.status)) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors disabled:opacity-40"
                                  title={isSuperAdmin ? "Admin Connect (barge-in)" : "Connect (admin)"}
                                  disabled={actionLoading === vm.id}
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
                                    ? "Admin Connect (barge-in) — joins this learner's desktop"
                                    : "Admin Connect (barge-in) — machine is not live; start it first"
                                  : "Connect (admin)"}
                              </TooltipContent>
                            </Tooltip>
                          )}
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
                          <AlertDialog
                            open={deleteConfirmVmId === vm.id}
                            onOpenChange={(open) => {
                              if (open) {
                                setDeleteConfirmVmId(vm.id);
                                setDeleteConfirmText("");
                              } else if (deleteConfirmVmId === vm.id) {
                                setDeleteConfirmVmId(null);
                                setDeleteConfirmText("");
                              }
                            }}
                          >
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
                                  This will permanently terminate{" "}
                                  <span className="font-mono">
                                    {vm.instanceName || `${vm.id.slice(0, 8)}…`}
                                  </span>{" "}
                                  and delete its cloud resources. This action cannot be undone. Type{" "}
                                  <span className="font-mono font-semibold text-foreground">DELETE</span> to
                                  confirm.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <Input
                                value={deleteConfirmVmId === vm.id ? deleteConfirmText : ""}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder='Type DELETE to confirm'
                                className="font-mono"
                                autoComplete="off"
                                aria-label="Type DELETE to confirm VM delete"
                              />
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteVM(vm.id, "admin_delete")}
                                  disabled={deleteConfirmText !== "DELETE"}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40"
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
                No VMs have been provisioned yet. Launch a lab from the Student Dashboard to see
                allocations appear here in real-time.
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
