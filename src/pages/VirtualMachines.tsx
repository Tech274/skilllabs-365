import { coalesceRuns, debounceWithMaxWait, dedupeBy, fetchAllForIds, fetchAllPages, type PageResult } from "@/lib/paged-query";
import { parseStopRetry, stopRetryBadge } from "@/lib/stop-retry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VMStatus } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { readFunctionError } from "@/lib/function-error";
import { remintAndWaitRunning, WalletBlockedError, REMINT_CALM_COPY, REMINT_FAIL_CODE } from "@/lib/lab-remint";
import { fetchVmWalletBlock } from "@/lib/lab-wallet";
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
import {
  buildLabWallet,
  formatMinutes,
  walletEquation,
  type LabWallet,
  type WalletSession,
  type WalletTemplate,
} from "@/lib/lab-wallet";
import { cn } from "@/lib/utils";

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
  /** Cleanup stop-retry marker lives here (see src/lib/stop-retry.ts). */
  ended_reason?: string | null;
  /** Template duration / window snapshot for wallet + expiry display. */
  templateDuration?: number | null;
  templateIsPersistent?: boolean | null;
  templateStartDate?: string | null;
  templateEndDate?: string | null;
  /** Wallet remaining minutes when computable (user + template sessions). */
  availableMinutes?: number | null;
  wallet?: LabWallet | null;
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

type TemplateJoin = {
  name?: string;
  duration?: number | null;
  is_persistent?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
};

/** Expiry: VM expires_at first; else persistent template end_date window. */
function resolveExpiryLabel(vm: VMRow): { primary: string; secondary: string | null } {
  if (vm.expires_at) {
    return {
      primary: formatDateTime(vm.expires_at),
      secondary: vm.wallet?.endLabel ? `Window ${vm.wallet.endLabel} IST` : null,
    };
  }
  if (vm.wallet?.endLabel) {
    return {
      primary: `${vm.wallet.endLabel} IST`,
      secondary: vm.wallet.windowEnded ? "Window ended" : "Template end",
    };
  }
  if (vm.templateEndDate) {
    const w = buildLabWallet(
      {
        id: vm.lab_template_id || "tmp",
        duration: vm.templateDuration,
        is_persistent: true,
        end_date: vm.templateEndDate,
        start_date: vm.templateStartDate,
      },
      [],
    );
    return {
      primary: w.endLabel ? `${w.endLabel} IST` : formatDateTime(vm.templateEndDate),
      secondary: w.windowEnded ? "Window ended" : "Template end",
    };
  }
  return { primary: "—", secondary: null };
}

function statusLabel(s: string): string {
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Realtime INSERT bursts (e.g. load tests) collapse into one fleet reload. */
const INSERT_RELOAD_DEBOUNCE_MS = 2000;
/** ...but a steady stream of INSERTs still reloads at least this often (Riley #59). */
const INSERT_RELOAD_MAX_WAIT_MS = 10_000;

function formatClock(d: Date): string {
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  /** Last successful fleet load; shown in the stale banner. */
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  /** Set when the latest refresh failed and the list on screen is older. */
  const [staleError, setStaleError] = useState<string | null>(null);
  /** Wallet usage failed on the latest load → Available Mins shown as unknown. */
  const [usageUnavailable, setUsageUnavailable] = useState(false);

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
        // Poll Start-from-deallocated ("starting") as well as fresh provision.
        .filter((vm) => vm.status === "provisioning" || vm.status === "starting")
        .map((vm) => vm.id)
        .sort()
        .join(","),
    [vms],
  );

  const loadVMsOnce = useCallback(async () => {
    setLoading(true);
    // No virtual_machines → profiles FK in schema (types.ts Relationships).
    // Join profiles separately like Sessions actor / User Admin / SessionAuditLog.
    // SCRUM-107: page past the 1000-row PostgREST cap (stable order: created_at, id).
    const { data: vmData, error, truncated: vmTruncated } = await fetchAllPages<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from("virtual_machines")
          .select(
            "*, lab_templates(name, duration, is_persistent, start_date, end_date)",
          )
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>,
    );
    if (vmTruncated) {
      console.warn(`virtual_machines: showing first ${vmData.length} rows (hard cap reached)`);
    }

    let rows: VMRow[] = [];

    if (error) {
      // Review follow-up: keep the last good list (a failed page used to blank
      // the whole fleet with a console-only error).
      console.error("Failed to load virtual_machines:", error.message);
      // Inline banner (stays until the next good load) + a toast for attention.
      setStaleError(error.message);
      toast({
        title: "Could not refresh the VM list",
        description: `${error.message} — showing the last loaded list.`,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    if (vmData) {
      // Offset paging is not snapshot-consistent: an insert between pages can
      // repeat a row. Dedupe by id (duplicate keys, double counts, bulk ids).
      rows = dedupeBy(vmData, (vm) => vm.id).map((vm: Record<string, unknown>) => {
        const labs = vm.lab_templates as TemplateJoin | null;
        const azureVmId = (vm.azure_vm_id as string | null) ?? null;
        return {
          ...(vm as unknown as VMRow),
          assigneeName: "—",
          assigneeEmail: null,
          labUsername: null,
          instanceName: extractInstanceName(azureVmId),
          labName: labs?.name || null,
          templateDuration: labs?.duration ?? null,
          templateIsPersistent: labs?.is_persistent ?? null,
          templateStartDate: labs?.start_date ?? null,
          templateEndDate: labs?.end_date ?? null,
          availableMinutes: null,
          wallet: null,
        };
      });
    }

    // Profiles (real username) + guac lab username + wallet sessions.
    if (rows.length > 0) {
      const vmIds = rows.map((r) => r.id);
      const userIds = Array.from(
        new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))),
      );

      type ProfileRow = { user_id: string; display_name: string; email: string | null };
      type UsageRow = {
        user_id: string | null;
        lab_template_id: string | null;
        started_at: string | null;
        ended_at: string | null;
      };

      type GuacRow = { vm_id: string | null; guac_username: string | null; started_at: string | null };

      // SCRUM-107: chunk id lists (URL size) and page each chunk (1000-row cap),
      // so owner names, lab usernames and wallet minutes cover the whole fleet.
      const profilesQuery = fetchAllForIds<ProfileRow, string>(userIds, (ids, from, to) =>
        supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", ids)
          .order("user_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<ProfileRow>>,
      );

      const guacQuery = fetchAllForIds<GuacRow, string>(vmIds, (ids, from, to) =>
        supabase
          .from("sessions")
          .select("vm_id, guac_username, started_at")
          .in("vm_id", ids)
          .not("guac_username", "is", null)
          .order("started_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<GuacRow>>,
      );

      const usageQuery = fetchAllForIds<UsageRow, string>(userIds, (ids, from, to) =>
        supabase
          .from("sessions")
          .select("user_id, lab_template_id, started_at, ended_at")
          .in("user_id", ids)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<UsageRow>>,
      );

      const [profilesResult, { data: sessionRows }, usageResult] = await Promise.all([
        profilesQuery,
        guacQuery,
        usageQuery,
      ]);

      const profileMap = new Map(
        ((profilesResult.data ?? []) as ProfileRow[]).map((p) => [p.user_id, p]),
      );
      rows = rows.map((r) => {
        if (!r.user_id) return r;
        const profile = profileMap.get(r.user_id);
        if (!profile) return r;
        return {
          ...r,
          // Same source as Sessions actor + User Administration
          assigneeName: profile.display_name || profile.email || "—",
          assigneeEmail: profile.email ?? null,
        };
      });

      // A failed usage chunk would under-count used minutes and OVERSTATE
      // Available Mins — show unknown instead of a wrong number.
      const usageFailed = Boolean(usageResult.error);
      setUsageUnavailable(usageFailed);
      if (usageFailed) {
        console.error("Failed to load wallet sessions:", usageResult.error?.message);
        toast({
          title: "Available minutes unavailable",
          description: "Session usage could not be loaded; minutes are shown as unknown.",
          variant: "destructive",
        });
      }
      const usageRows: UsageRow[] = (usageResult.data ?? []) as UsageRow[];

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

      // Frontend wallet remaining (PR #24 pattern): allocated template duration − used sessions.
      const usageByUser = new Map<string, WalletSession[]>();
      for (const s of usageRows) {
        const uid = s.user_id;
        if (!uid) continue;
        const list = usageByUser.get(uid) ?? [];
        list.push({
          lab_template_id: s.lab_template_id,
          started_at: s.started_at,
          ended_at: s.ended_at,
        });
        usageByUser.set(uid, list);
      }

      rows = rows.map((r) => {
        if (usageFailed || !r.user_id || !r.lab_template_id) {
          return { ...r, availableMinutes: null, wallet: null };
        }
        const duration = r.templateDuration;
        if (
          (duration == null || Number(duration) <= 0) &&
          !r.templateEndDate &&
          !r.templateIsPersistent
        ) {
          return { ...r, availableMinutes: null, wallet: null };
        }
        const template: WalletTemplate = {
          id: r.lab_template_id,
          duration: duration ?? 0,
          is_persistent: r.templateIsPersistent,
          start_date: r.templateStartDate,
          end_date: r.templateEndDate,
        };
        const sessions = usageByUser.get(r.user_id) ?? [];
        const wallet = buildLabWallet(template, sessions);
        return {
          ...r,
          wallet,
          availableMinutes:
            template.duration && template.duration > 0 ? wallet.remainingMinutes : null,
        };
      });
    }

    setVms(rows);
    setStaleError(null);
    setLastLoadedAt(new Date());
    setLoading(false);
  }, []);

  // Review follow-up (SCRUM-107): full-fleet loads are now many requests, so
  // serialise them. A request while one is in flight queues ONE follow-up run
  // (latest state wins, no out-of-order setVms), and realtime INSERT bursts are
  // debounced instead of each triggering a full reload.
  const fetchVMs = useMemo(() => coalesceRuns(loadVMsOnce), [loadVMsOnce]);
  // 2 s trailing debounce with a 10 s max wait: bursts collapse into one
  // reload, and a steady INSERT stream still shows new rows every 10 s.
  const insertReload = useMemo(
    () => debounceWithMaxWait(() => void fetchVMs(), INSERT_RELOAD_DEBOUNCE_MS, INSERT_RELOAD_MAX_WAIT_MS),
    [fetchVMs],
  );
  const scheduleReload = insertReload.schedule;

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
      if (vm.templateIsPersistent && vm.lab_template_id) {
        const block = await fetchVmWalletBlock(vm.id);
        if (block) throw new WalletBlockedError(block.code, block.message);
        await remintAndWaitRunning({
          vmId: vm.id,
          labTemplateId: vm.lab_template_id,
          isPersistent: true,
          onPhase: (phase) => {
            if (phase !== "waiting-running") return;
            toast({
              title: "VM Starting",
              description: `Machine ${vm.instanceName || vm.id.slice(0, 8)}… is powering on (same allocation).`,
            });
            setVms((prev) => prev.map((row) => (row.id === vm.id ? { ...row, status: "starting" } : row)));
          },
        });
        setVms((prev) => prev.map((row) => (row.id === vm.id ? { ...row, status: "running" } : row)));
        toast({ title: "VM Running", description: "Same machine is back on. Connect is available." });
        return;
      }
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "start-vm", vm_id: vm.id, reason: "admin_start" },
      });
      // Non-2xx hides JSON in FunctionsHttpError.context — unwrap like LabManagement/remint.
      if (error || data?.error) {
        // P0a: ghost reconcile may have marked Hub failed — reflect in UI.
        const msg = await readFunctionError(error, data);
        if (/GHOST_INSTANCE|ghost|not-found|InvalidInstanceID/i.test(msg)) {
          setVms((prev) => prev.map((row) => (row.id === vm.id ? { ...row, status: "failed" } : row)));
        }
        throw new Error(msg);
      }
      toast({
        title: "VM Starting",
        description: `Machine ${vm.instanceName || vm.id.slice(0, 8)}… is powering on (same allocation).`,
      });
      setVms((prev) => prev.map((row) => (row.id === vm.id ? { ...row, status: "starting" } : row)));
    } catch (err: unknown) {
      if (err instanceof WalletBlockedError) {
        toast({
          title: err.code === "LAB_WINDOW_ENDED" ? "Lab access period ended" : "No minutes left",
          description: err.message,
          variant: "destructive",
        });
        return;
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      // P0b: always show detail/code/aws_state from unwrapped edge body.
      toast({
        title: "Failed to start VM",
        description: msg.startsWith(REMINT_FAIL_CODE) ? `${REMINT_CALM_COPY} (${msg})` : msg,
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
            scheduleReload();
          } else if (payload.eventType === "DELETE") {
            setVms((prev) => prev.filter((vm) => vm.id !== (payload.old as VMRow).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      insertReload.cancel();
    };
  }, [fetchVMs, scheduleReload, insertReload]);

  // Admin Allocation does not use learner use-provisioning — poll check-vm-status
  // for rows still in provisioning/starting so cloud Running flips Hub to running.
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
            if (!nextStatus || nextStatus === "provisioning" || nextStatus === "starting") continue;
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

  const needsAdminCount = useMemo(
    () => vms.filter((vm) => parseStopRetry(vm.ended_reason)?.kind === "needs_admin").length,
    [vms],
  );

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

  // Full Hub status set — filter + badge fidelity (MakeMyLabs Manage VM parity).
  const allStatuses: VMStatus[] = [
    "running",
    "idle",
    "stopped",
    "deallocated",
    "failed",
    "provisioning",
    "starting",
    "expired",
    "terminated",
  ];
  /** Soft-stop / deallocate: Running + Idle only (not provisioning/starting). */
  const isStoppableStatus = (s: string) => ["running", "idle"].includes(s);
  const isResumableStatus = (s: string) => ["stopped", "deallocated"].includes(s);
  const isConnectableStatus = (s: string) => ["running", "idle"].includes(s);
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

        {staleError && (
          <Alert variant="destructive" data-testid="vms-stale-banner">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Showing an older list — the latest refresh failed</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>
                {lastLoadedAt ? `Data as of ${formatClock(lastLoadedAt)} IST.` : "No list has loaded yet."} {staleError}
              </span>
              <Button variant="outline" size="sm" className="h-7" onClick={fetchVMs}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!staleError && usageUnavailable && (
          <Alert data-testid="vms-usage-banner">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Available minutes unavailable</AlertTitle>
            <AlertDescription>Session usage could not be loaded, so Available Mins shows “—” instead of a wrong number.</AlertDescription>
          </Alert>
        )}
        {needsAdminCount > 0 && (
          <Alert variant="destructive" data-testid="vms-needs-admin-banner">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {needsAdminCount} machine{needsAdminCount === 1 ? "" : "s"} need{needsAdminCount === 1 ? "s" : ""} attention — automatic stop failed
            </AlertTitle>
            <AlertDescription>
              Cleanup gave up after repeated cloud stop failures and stopped retrying. Check the instance in the cloud
              console, then Stop or Delete it here (either clears the flag).
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p>
              <span className="font-medium text-foreground">Allocation view</span> — MakeMyLabs-style
              Manage VM thin slice: Status, Available Mins (wallet remaining), Expiry (
              <code className="text-[10px]">expires_at</code> / template end window), plus assignee /
              lab user / instance identity.
            </p>
            <p>
              <span className="font-medium text-foreground">Available Mins</span> is computed on the
              frontend from template duration − session usage (same wallet math as Student Dashboard /
              PR #24). No edge change required.
            </p>
            <p>
              Actions: <span className="font-medium text-foreground">Start / Stop / Connect / Delete</span>{" "}
              via <code className="text-[10px]">cleanup-idle-labs</code>. Start resumes the same
              Stopped/Deallocated allocation. Soft Stop only on Running/Idle (deallocate, never purge).
              Connect barge on Running/Idle.
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
                <SelectItem key={s} value={s}>
                  {statusLabel(s)}
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
                    {[
                      "Assignee",
                      "Lab username",
                      "Instance / VM name",
                      "Status",
                      "Available Mins",
                      "Expiry",
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
                        {(() => {
                          const badge = stopRetryBadge(vm.ended_reason);
                          if (!badge) return null;
                          return (
                            <div
                              title={badge.title}
                              className={cn(
                                "mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                badge.tone === "destructive"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/10 text-warning",
                              )}
                            >
                              <AlertTriangle className="h-3 w-3" /> {badge.label}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {vm.availableMinutes == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "font-mono text-xs font-semibold",
                                  vm.wallet?.exhausted || vm.wallet?.windowEnded
                                    ? "text-destructive"
                                    : vm.wallet &&
                                        vm.wallet.allocatedMinutes > 0 &&
                                        vm.wallet.remainingMinutes <=
                                          Math.max(vm.wallet.allocatedMinutes * 0.1, 5)
                                      ? "text-warning"
                                      : "text-foreground",
                                )}
                              >
                                {formatMinutes(vm.availableMinutes)}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {vm.wallet
                                ? `${walletEquation(vm.wallet)} min remaining`
                                : "Wallet remaining"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {(() => {
                          const exp = resolveExpiryLabel(vm);
                          return (
                            <div>
                              <div
                                className={cn(
                                  "text-foreground",
                                  vm.wallet?.windowEnded && "text-destructive",
                                )}
                              >
                                {exp.primary}
                              </div>
                              {exp.secondary && (
                                <div className="mt-0.5 text-[10px] text-muted-foreground">
                                  {exp.secondary}
                                </div>
                              )}
                            </div>
                          );
                        })()}
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
                          {(isSuperAdmin || isConnectableStatus(vm.status)) && (
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
                                  ? isConnectableStatus(vm.status)
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
                                title="Stop / soft-stop"
                                disabled={!isStoppableStatus(vm.status) || actionLoading === vm.id}
                                onClick={() => handleStopVM(vm.id)}
                              >
                                {actionLoading === vm.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <StopCircle className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Soft Stop — deallocate only (Running/Idle)</TooltipContent>
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
