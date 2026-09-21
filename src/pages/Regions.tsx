import { DashboardLayout } from "@/components/DashboardLayout";
import { Globe, Server, Wifi, Clock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface RegionStats {
  region: string;
  activeVMs: number;
  totalVMs: number;
  activeSessions: number;
  avgIdleMinutes: number;
}

export default function Regions() {
  const [regions, setRegions] = useState<RegionStats[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRegionStats = useCallback(async () => {
    const [vmRes, sessionRes] = await Promise.all([
      supabase.from("virtual_machines").select("region, status, idle_minutes"),
      supabase.from("sessions").select("region, status"),
    ]);

    const vmData = vmRes.data || [];
    const sessionData = sessionRes.data || [];

    const regionMap = new Map<string, RegionStats>();
    for (const vm of vmData) {
      const r = vm.region;
      if (!regionMap.has(r)) regionMap.set(r, { region: r, activeVMs: 0, totalVMs: 0, activeSessions: 0, avgIdleMinutes: 0 });
      const stats = regionMap.get(r)!;
      stats.totalVMs++;
      if (['running', 'idle'].includes(vm.status)) stats.activeVMs++;
    }
    for (const s of sessionData) {
      const r = s.region;
      if (!regionMap.has(r)) regionMap.set(r, { region: r, activeVMs: 0, totalVMs: 0, activeSessions: 0, avgIdleMinutes: 0 });
      if (s.status === 'active') regionMap.get(r)!.activeSessions++;
    }

    // If no data, show the two configured regions
    if (regionMap.size === 0) {
      regionMap.set('East US', { region: 'East US', activeVMs: 0, totalVMs: 0, activeSessions: 0, avgIdleMinutes: 0 });
      regionMap.set('Central India', { region: 'Central India', activeVMs: 0, totalVMs: 0, activeSessions: 0, avgIdleMinutes: 0 });
    }

    setRegions(Array.from(regionMap.values()));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRegionStats();
    const channel = supabase
      .channel("region-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "virtual_machines" }, () => fetchRegionStats())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRegionStats]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Regions</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-region infrastructure status</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading region data...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {regions.map((r, i) => (
              <motion.div
                key={r.region}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="rounded-xl border border-border bg-card p-6 space-y-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Globe className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{r.region}</h3>
                    <p className={cn("text-xs font-medium uppercase tracking-wider", r.activeVMs > 0 ? "text-success" : "text-muted-foreground")}>
                      ● {r.activeVMs > 0 ? 'healthy' : 'idle'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { icon: Server, label: 'Active VMs', value: r.activeVMs, to: '/vms?status=active' },
                    { icon: Server, label: 'Total VMs', value: r.totalVMs, to: '/vms' },
                    { icon: Wifi, label: 'Sessions', value: r.activeSessions, to: '/sessions?status=active' },
                    { icon: Clock, label: 'Status', value: r.activeVMs > 0 ? 'Active' : 'Idle', to: r.activeVMs > 0 ? '/vms?status=active' : '/vms?status=idle' },
                  ].map(m => (
                    <Link
                      key={m.label}
                      to={m.to}
                      className="rounded-lg bg-muted/50 p-3 block transition-colors hover:bg-muted hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${m.label}: ${m.value}`}
                    >
                      <m.icon className="h-4 w-4 text-muted-foreground mb-1" />
                      <p className="text-lg font-mono font-semibold text-foreground">{m.value}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                    </Link>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4">Azure Front Door Routing</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Global Routing', value: 'Active', color: 'text-success' },
              { label: 'Health Probes', value: 'Passing', color: 'text-success' },
              { label: 'Failover', value: 'Standby', color: 'text-warning' },
            ].map(item => (
              <div key={item.label} className="rounded-lg bg-muted/50 p-4 text-center">
                <p className={cn("text-lg font-semibold", item.color)}>{item.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
