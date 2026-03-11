import { DashboardLayout } from "@/components/DashboardLayout";
import { regionHealthData } from "@/lib/mock-data";
import { Globe, Server, Database, Cpu, Wifi, Clock, HardDrive } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const healthColor = {
  healthy: 'text-success',
  degraded: 'text-warning',
  down: 'text-destructive',
};

export default function Regions() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Regions</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-region infrastructure status</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {regionHealthData.map((r, i) => (
            <motion.div
              key={r.region}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="rounded-xl border border-border bg-card p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Globe className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{r.region}</h3>
                    <p className={cn("text-xs font-medium uppercase tracking-wider", healthColor[r.status])}>
                      ● {r.status}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { icon: Server, label: 'Active VMs', value: r.activeVMs },
                  { icon: HardDrive, label: 'Warm Pool', value: r.warmPoolVMs },
                  { icon: Cpu, label: 'AKS Nodes', value: r.aksNodes },
                  { icon: Database, label: 'AKS Pods', value: r.aksPodsRunning },
                  { icon: Wifi, label: 'Connections', value: r.activeConnections },
                  { icon: Clock, label: 'Avg Provision', value: `${r.avgProvisioningTime}s` },
                ].map(m => (
                  <div key={m.label} className="rounded-lg bg-muted/50 p-3">
                    <m.icon className="h-4 w-4 text-muted-foreground mb-1" />
                    <p className="text-lg font-mono font-semibold text-foreground">{m.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Redis Cache Hit Rate</span>
                  <span className="font-mono text-foreground">{r.redisCacheHitRate}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-success transition-all" style={{ width: `${r.redisCacheHitRate}%` }} />
                </div>
              </div>
            </motion.div>
          ))}
        </div>

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
