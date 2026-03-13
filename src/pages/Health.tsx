import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AiInsightCard } from "@/components/AiInsightCard";

interface ServiceStatus {
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latency?: string;
  uptime: string;
}

const services: ServiceStatus[] = [
  { name: 'AKS Cluster (East US)', status: 'operational', latency: '12ms', uptime: '99.98%' },
  { name: 'AKS Cluster (Central India)', status: 'operational', latency: '18ms', uptime: '99.95%' },
  { name: 'Guacamole Web', status: 'operational', latency: '45ms', uptime: '99.99%' },
  { name: 'Guacd Daemon', status: 'operational', latency: '8ms', uptime: '99.97%' },
  { name: 'Redis Cache (East US)', status: 'operational', latency: '2ms', uptime: '99.99%' },
  { name: 'Redis Cache (Central India)', status: 'operational', latency: '3ms', uptime: '99.99%' },
  { name: 'MySQL (East US)', status: 'operational', latency: '5ms', uptime: '99.96%' },
  { name: 'MySQL (Central India)', status: 'degraded', latency: '42ms', uptime: '99.82%' },
  { name: 'VM Orchestrator', status: 'operational', latency: '22ms', uptime: '99.94%' },
  { name: 'Azure Front Door', status: 'operational', latency: '6ms', uptime: '99.99%' },
  { name: 'Application Gateway (WAF)', status: 'operational', latency: '15ms', uptime: '99.97%' },
  { name: 'Key Vault', status: 'operational', latency: '8ms', uptime: '99.99%' },
];

const statusIcon = {
  operational: <CheckCircle2 className="h-4 w-4 text-success" />,
  degraded: <AlertTriangle className="h-4 w-4 text-warning" />,
  down: <XCircle className="h-4 w-4 text-destructive" />,
};

const statusText = {
  operational: 'text-success',
  degraded: 'text-warning',
  down: 'text-destructive',
};

export default function Health() {
  const degradedCount = services.filter(s => s.status !== 'operational').length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {degradedCount === 0 ? 'All systems operational' : `${degradedCount} service(s) degraded`}
          </p>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card divide-y divide-border">
          {services.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {statusIcon[s.status]}
                <span className="text-sm text-foreground">{s.name}</span>
              </div>
              <div className="flex items-center gap-6">
                {s.latency && (
                  <span className="text-xs font-mono text-muted-foreground">{s.latency}</span>
                )}
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">{s.uptime}</span>
                <span className={cn("text-xs font-medium capitalize w-20 text-right", statusText[s.status])}>
                  {s.status}
                </span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
