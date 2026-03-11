import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { sessionHistory, labVMs } from "@/lib/mock-data";
import { Users, Clock, TrendingUp, Timer } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";

export default function Sessions() {
  const activeSessions = labVMs.filter(v => v.status === 'running').length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">Active Guacamole sessions and analytics</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Active Sessions" value="483" icon={Users} variant="success" />
          <MetricCard title="Peak Today" value="612" icon={TrendingUp} variant="primary" subtitle="at 14:00 UTC" />
          <MetricCard title="Avg Duration" value="42m" icon={Clock} variant="default" />
          <MetricCard title="Avg Idle" value="6.2m" icon={Timer} variant="warning" subtitle="before auto-stop" />
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4">Session Volume (24h)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={sessionHistory}>
              <defs>
                <linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="vmGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(152 60% 45%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(152 60% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} />
              <Area type="monotone" dataKey="sessions" stroke="hsl(187 80% 48%)" fill="url(#sGrad)" strokeWidth={2} name="Sessions" />
              <Area type="monotone" dataKey="vms" stroke="hsl(152 60% 45%)" fill="url(#vmGrad)" strokeWidth={2} name="Active VMs" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card">
          <div className="p-5 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">Active Sessions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['User', 'Lab', 'VM', 'Region', 'Duration', 'Idle'].map(h => (
                    <th key={h} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labVMs.filter(v => v.status === 'running').slice(0, 10).map(vm => (
                  <tr key={vm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 text-foreground">{vm.userName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.labName}</td>
                    <td className="px-5 py-3 font-mono text-xs text-primary">{vm.id}</td>
                    <td className="px-5 py-3 text-muted-foreground">{vm.region}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{Math.floor(Math.random() * 60 + 5)}m</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">0m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
