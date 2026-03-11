import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { labVMs, vmStatusCounts, sessionHistory, regionHealthData } from "@/lib/mock-data";
import { Server, Users, Activity, Clock, Globe, Zap } from "lucide-react";
import { motion } from "framer-motion";
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

const statusDistribution = [
  { name: 'Running', value: vmStatusCounts.running, fill: 'hsl(152 60% 45%)' },
  { name: 'Idle', value: vmStatusCounts.idle, fill: 'hsl(38 90% 55%)' },
  { name: 'Provisioning', value: vmStatusCounts.provisioning, fill: 'hsl(210 80% 55%)' },
  { name: 'Starting', value: vmStatusCounts.starting, fill: 'hsl(187 80% 48%)' },
  { name: 'Expired', value: vmStatusCounts.expired, fill: 'hsl(0 72% 55%)' },
  { name: 'Stopped', value: vmStatusCounts.stopped, fill: 'hsl(215 12% 52%)' },
];

const Index = () => {
  const recentVMs = labVMs.slice(0, 8);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time platform overview</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricCard title="Active VMs" value={vmStatusCounts.running + vmStatusCounts.idle} icon={Server} variant="primary" trend={{ value: 12, label: 'vs last hour' }} />
          <MetricCard title="Active Sessions" value="483" icon={Users} variant="success" subtitle="312 East US · 171 India" />
          <MetricCard title="Avg Provision" value="47s" icon={Clock} variant="default" trend={{ value: -8, label: 'improvement' }} />
          <MetricCard title="Idle VMs" value={vmStatusCounts.idle} icon={Activity} variant="warning" subtitle="Auto-stop in ≤20min" />
          <MetricCard title="Regions" value="2/2" icon={Globe} variant="success" subtitle="All healthy" />
          <MetricCard title="AKS Pods" value="80" icon={Zap} variant="primary" subtitle="20 nodes" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">Sessions (24h)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={sessionHistory}>
                <defs>
                  <linearGradient id="sessionGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                <Area type="monotone" dataKey="sessions" stroke="hsl(187 80% 48%)" fill="url(#sessionGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">VM Status</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={statusDistribution} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} width={80} />
                <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Region Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {regionHealthData.map((r) => (
            <motion.div key={r.region} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium text-foreground">{r.region}</h3>
                </div>
                <StatusBadge status="running" />
              </div>
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  { label: 'VMs', value: r.activeVMs },
                  { label: 'Warm Pool', value: r.warmPoolVMs },
                  { label: 'AKS Pods', value: r.aksPodsRunning },
                  { label: 'Cache Hit', value: `${r.redisCacheHitRate}%` },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg bg-muted/50 p-2">
                    <p className="text-lg font-mono font-semibold text-foreground">{m.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Recent VMs Table */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card">
          <div className="p-5 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">Recent Virtual Machines</h3>
          </div>
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
                {recentVMs.map((vm) => (
                  <tr key={vm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-primary">{vm.id}</td>
                    <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.region}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.privateIp}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.vmSize}</td>
                    <td className="px-5 py-3"><StatusBadge status={vm.status} /></td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{vm.idleMinutes > 0 ? `${vm.idleMinutes}m` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
