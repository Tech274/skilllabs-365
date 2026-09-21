import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import type { VMStatus } from "@/lib/types";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Monitor, Cpu, HardDrive, Clock, Activity, Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// Mock perf data — in production this would come from Azure Monitor
const perfData = Array.from({ length: 30 }, (_, i) => ({
  time: `${i}m`,
  cpu: Math.floor(Math.random() * 40) + 15,
  memory: Math.floor(Math.random() * 20) + 55,
}));

interface VMDetailData {
  id: string;
  status: string;
  region: string;
  vm_size: string;
  private_ip: string | null;
  idle_minutes: number;
  azure_vm_id: string | null;
  created_at: string;
  expires_at: string | null;
  userName: string;
  labName: string;
}

export default function VMDetail() {
  const { vmId } = useParams<{ vmId: string }>();
  const [vm, setVm] = useState<VMDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  const fetchVM = useCallback(async () => {
    if (!vmId) return;
    setLoadError(null);
    // No virtual_machines → profiles FK; resolve owner via profiles batch
    // (same source as Sessions actor / User Administration).
    const { data, error } = await supabase
      .from("virtual_machines")
      .select("*, lab_templates(name)")
      .eq("id", vmId)
      .single();

    if (error) {
      // PGRST116 = no rows; anything else is often RLS failure, not a missing VM
      const isNotFound = error.code === "PGRST116";
      setVm(null);
      setLoadError(
        isNotFound
          ? null
          : error.message ||
              "Could not load this VM (permission or related-record lookup failed).",
      );
    } else if (data) {
      let userName = "—";
      const ownerId = (data as any).user_id as string | null;
      if (ownerId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name, email")
          .eq("user_id", ownerId)
          .maybeSingle();
        userName = profile?.display_name || profile?.email || "—";
      }
      setVm({
        ...data,
        userName,
        labName: (data as any).lab_templates?.name || "—",
      });
      setLoadError(null);
    } else {
      setVm(null);
      setLoadError(null);
    }
    setLoading(false);
  }, [vmId]);

  const fetchEvents = useCallback(async () => {
    if (!vmId) return;
    // Fetch session events related to this VM
    const { data: sessions } = await supabase.from("sessions").select("id").eq("vm_id", vmId);
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      const { data: evts } = await supabase
        .from("session_events")
        .select("*")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: false })
        .limit(10);
      if (evts) setEvents(evts);
    }
  }, [vmId]);

  useEffect(() => {
    fetchVM();
    fetchEvents();
  }, [fetchVM, fetchEvents]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading VM details...
        </div>
      </DashboardLayout>
    );
  }

  if (!vm) {
    return (
      <DashboardLayout>
        <div className="text-center py-16 space-y-2">
          <p className="text-muted-foreground">
            {loadError
              ? "Unable to load VM details."
              : "VM not found."}
          </p>
          {loadError && (
            <p className="text-sm text-destructive max-w-md mx-auto font-mono">
              {loadError}
            </p>
          )}
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {loadError
              ? "This is often a permissions (RLS) or related-record join issue — not proof the VM id is missing."
              : "No virtual_machines row matched this id."}
          </p>
          <Link to="/vms" className="text-primary hover:underline text-sm mt-2 inline-block">← Back to VMs</Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/vms">
              <Button variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-foreground font-mono">{vm.id.slice(0, 8)}…</h1>
                <StatusBadge status={vm.status as VMStatus} />
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{vm.labName} · {vm.userName} · {vm.region}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">Stop VM</Button>
            <Button variant="destructive" size="sm">Delete VM</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="VM Size" value={vm.vm_size} icon={Cpu} variant="default" to="/costs" />
          <MetricCard title="Private IP" value={vm.private_ip || "—"} icon={Monitor} variant="primary" to="/admin/network-health" />
          <MetricCard title="Idle Time" value={vm.idle_minutes > 0 ? `${vm.idle_minutes}m` : '0m'} icon={Clock} variant={vm.idle_minutes > 10 ? 'warning' : 'default'} subtitle="20m auto-stop" to="/vms?status=idle" />
          <MetricCard title="Disk" value="Ephemeral" icon={HardDrive} variant="default" subtitle="30 GB" to="/vms" />
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Remote Session</h3>
            </div>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${vm.status === 'running' ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
              <span className="text-xs text-muted-foreground">{vm.status === 'running' ? 'Connected via RDP' : 'Disconnected'}</span>
            </div>
          </div>
          <div className="relative bg-muted/30 flex items-center justify-center" style={{ height: '400px' }}>
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Monitor className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Guacamole Session</p>
                <p className="text-xs text-muted-foreground mt-1">
                  In production, this embeds the Apache Guacamole client via iframe
                </p>
                <p className="text-xs font-mono text-primary mt-2">
                  guacamole.cloudlab.io/client/{vm.id}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Performance (30m)</h3>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={perfData}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(38 90% 55%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(38 90% 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                <Area type="monotone" dataKey="cpu" stroke="hsl(187 80% 48%)" fill="url(#cpuGrad)" strokeWidth={2} name="CPU" />
                <Area type="monotone" dataKey="memory" stroke="hsl(38 90% 55%)" fill="url(#memGrad)" strokeWidth={2} name="Memory" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
              <Terminal className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Session Events</h3>
            </div>
            <div className="p-3 space-y-0.5 max-h-[252px] overflow-y-auto font-mono text-xs">
              {events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No session events recorded.</div>
              ) : (
                events.map((evt, i) => (
                  <div key={i} className="flex gap-3 px-2 py-1.5 rounded hover:bg-muted/30">
                    <span className="text-muted-foreground shrink-0">{new Date(evt.created_at).toLocaleTimeString()}</span>
                    <span className="text-info">{evt.event_type}</span>
                    <span className="text-foreground truncate">{JSON.stringify(evt.event_data)}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </DashboardLayout>
  );
}
