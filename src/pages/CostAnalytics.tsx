import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { costData } from "@/lib/mock-data";
import { DollarSign, TrendingDown, Calculator, Coins } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { motion } from "framer-motion";

const COLORS = [
  'hsl(187 80% 48%)', 'hsl(210 80% 55%)', 'hsl(152 60% 45%)',
  'hsl(38 90% 55%)', 'hsl(280 60% 55%)', 'hsl(0 72% 55%)',
];

const dailyCost = Array.from({ length: 14 }, (_, i) => ({
  day: `Mar ${i + 1}`,
  cost: Math.floor(Math.random() * 800) + 1200,
}));

export default function CostAnalytics() {
  const totalMonthly = costData.reduce((s, c) => s + c.cost, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Cost Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Infrastructure spend and optimization</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Monthly Spend" value={`$${totalMonthly.toLocaleString()}`} icon={DollarSign} variant="primary" />
          <MetricCard title="Cost/Session" value="$4.82" icon={Calculator} variant="default" trend={{ value: -6, label: 'vs last month' }} />
          <MetricCard title="Savings" value="$3,200" icon={TrendingDown} variant="success" subtitle="Auto-stop + Spot VMs" />
          <MetricCard title="Budget Used" value="68%" icon={Coins} variant="warning" subtitle="$35,000 monthly budget" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">Daily Spend (14d)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyCost}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} formatter={(v: number) => [`$${v}`, 'Cost']} />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]} fill="hsl(187 80% 48%)" />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">Cost Breakdown</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={costData} dataKey="cost" nameKey="category" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {costData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {costData.map((c, i) => (
                  <div key={c.category} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                      <span className="text-muted-foreground">{c.category}</span>
                    </div>
                    <span className="font-mono text-foreground">${c.cost.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4">Cost Optimization Recommendations</h3>
          <div className="space-y-3">
            {[
              { title: 'Switch 12 Standard_D2s VMs to B2ms', saving: '$420/mo', impact: 'Low risk' },
              { title: 'Enable Spot VMs for trial labs', saving: '$1,800/mo', impact: 'Medium risk' },
              { title: 'Reduce idle timeout from 20m to 15m', saving: '$340/mo', impact: 'Low risk' },
              { title: 'Scale down India AKS nodes off-peak', saving: '$640/mo', impact: 'Low risk' },
            ].map(r => (
              <div key={r.title} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <div>
                  <p className="text-sm text-foreground">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.impact}</p>
                </div>
                <span className="text-sm font-mono text-success font-medium">{r.saving}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
