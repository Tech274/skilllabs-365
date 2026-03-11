import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { labVMs } from "@/lib/mock-data";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Monitor, Cpu, HardDrive, Clock, Activity, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Mock CPU/Memory data for the VM
const perfData = Array.from({ length: 30 }, (_, i) => ({
  time: `${i}m`,
  cpu: Math.floor(Math.random() * 40) + 15,
  memory: Math.floor(Math.random() * 20) + 55,
}));

const vmLogs = [
  { time: '14:32:01', level: 'INFO', message: 'Guacamole connection established (RDP)' },
  { time: '14:31:58', level: 'INFO', message: 'VM started successfully' },
  { time: '14:31:45', level: 'INFO', message: 'Network interface attached to private subnet' },
  { time: '14:31:30', level: 'INFO', message: 'OS disk provisioned (ephemeral)' },
  { time: '14:31:15', level: 'INFO', message: 'VM provisioning initiated by orchestrator' },
  { time: '14:31:10', level: 'INFO', message: 'Credentials retrieved from Key Vault' },
  { time: '14:31:05', level: 'INFO', message: 'VM assigned to user alice.chen@corp.com' },
  { time: '14:30:58', level: 'DEBUG', message: 'Azure SDK: CreateVM request submitted' },
  { time: '14:30:55', level: 'INFO', message: 'Warm pool VM selected: Standard_B2ms' },
  { time: '14:30:50', level: 'INFO', message: 'Lab session initiated: Azure Fundamentals' },
];

export default function VMDetail() {
  const { vmId } = useParams<{ vmId: string }>();
  const vm = labVMs.find(v => v.id === vmId) || labVMs[0];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/vms">
              <Button variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-foreground font-mono">{vm.id}</h1>
                <StatusBadge status={vm.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{vm.labName} · {vm.userName} · {vm.region}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">Stop VM</Button>
            <Button variant="destructive" size="sm">Delete VM</Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="VM Size" value={vm.vmSize} icon={Cpu} variant="default" />
          <MetricCard title="Private IP" value={vm.privateIp} icon={Monitor} variant="primary" />
          <MetricCard title="Idle Time" value={vm.idleMinutes > 0 ? `${vm.idleMinutes}m` : '0m'} icon={Clock} variant={vm.idleMinutes > 10 ? 'warning' : 'default'} subtitle="20m auto-stop" />
          <MetricCard title="Disk" value="Ephemeral" icon={HardDrive} variant="default" subtitle="30 GB" />
        </div>

        {/* Guacamole Session Embed */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">Remote Session</h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs text-muted-foreground">Connected via RDP</span>
            </div>
          </div>
          <div className="relative bg-muted/30 flex items-center justify-center" style={{ height: '400px' }}>
            {/* This would be an iframe to Guacamole in production */}
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
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
              <div className="flex justify-center gap-4 text-xs text-muted-foreground">
                <span>Protocol: RDP</span>
                <span>·</span>
                <span>Resolution: 1920×1080</span>
                <span>·</span>
                <span>Clipboard: Enabled</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Performance Charts + Logs */}
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
              <h3 className="text-sm font-medium text-foreground">VM Logs</h3>
            </div>
            <div className="p-3 space-y-0.5 max-h-[252px] overflow-y-auto font-mono text-xs">
              {vmLogs.map((log, i) => (
                <div key={i} className="flex gap-3 px-2 py-1.5 rounded hover:bg-muted/30">
                  <span className="text-muted-foreground shrink-0">{log.time}</span>
                  <span className={log.level === 'DEBUG' ? 'text-muted-foreground' : 'text-info'}>{log.level.padEnd(5)}</span>
                  <span className="text-foreground">{log.message}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </DashboardLayout>
  );
}
