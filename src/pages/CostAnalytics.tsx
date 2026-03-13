import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { DollarSign, TrendingDown, Calculator, Coins, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { motion } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const COLORS = [
  'hsl(187 80% 48%)', 'hsl(210 80% 55%)', 'hsl(152 60% 45%)',
  'hsl(38 90% 55%)', 'hsl(280 60% 55%)', 'hsl(0 72% 55%)',
];

// VM size to estimated hourly cost mapping (USD)
const VM_COST_PER_HOUR: Record<string, number> = {
  'Standard_B2s': 0.0416,
  'Standard_B2ms': 0.0832,
  'Standard_B4ms': 0.166,
  'Standard_D2s_v3': 0.096,
};

export default function CostAnalytics() {
  const [loading, setLoading] = useState(true);
  const [costBreakdown, setCostBreakdown] = useState<{ category: string; cost: number; percentage: number }[]>([]);
  const [totalMonthly, setTotalMonthly] = useState(0);

  const fetchCostData = useCallback(async () => {
    const { data: vms } = await supabase.from("virtual_machines").select("vm_size, status, created_at");

    if (vms && vms.length > 0) {
      const sizeMap = new Map<string, number>();
      const now = Date.now();
      for (const vm of vms) {
        const hours = Math.max(1, (now - new Date(vm.created_at).getTime()) / 3600000);
        const rate = VM_COST_PER_HOUR[vm.vm_size] || 0.05;
        const cost = hours * rate;
        sizeMap.set(vm.vm_size, (sizeMap.get(vm.vm_size) || 0) + cost);
      }
      const totalCost = Array.from(sizeMap.values()).reduce((a, b) => a + b, 0);
      const breakdown = Array.from(sizeMap.entries()).map(([category, cost]) => ({
        category,
        cost: Math.round(cost * 100) / 100,
        percentage: totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0,
      })).sort((a, b) => b.cost - a.cost);

      setCostBreakdown(breakdown);
      setTotalMonthly(Math.round(totalCost * 100) / 100);
    } else {
      setCostBreakdown([]);
      setTotalMonthly(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Cost Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Infrastructure spend estimates based on VM usage</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculating costs...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Estimated Spend" value={`$${totalMonthly.toLocaleString()}`} icon={DollarSign} variant="primary" />
              <MetricCard title="VM Types" value={costBreakdown.length} icon={Calculator} variant="default" />
              <MetricCard title="Cost Optimization" value="Available" icon={TrendingDown} variant="success" subtitle="See recommendations" />
              <MetricCard title="Data Source" value="Live" icon={Coins} variant="default" subtitle="Based on real VM records" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-foreground mb-4">Cost by VM Size</h3>
                {costBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={costBreakdown}>
                      <XAxis dataKey="category" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']} />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                        {costBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">No cost data available.</div>
                )}
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-foreground mb-4">Cost Breakdown</h3>
                {costBreakdown.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={costBreakdown} dataKey="cost" nameKey="category" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                          {costBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {costBreakdown.map((c, i) => (
                        <div key={c.category} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-muted-foreground">{c.category}</span>
                          </div>
                          <span className="font-mono text-foreground">${c.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">No data.</div>
                )}
              </motion.div>
            </div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-medium text-foreground mb-4">Cost Optimization Recommendations</h3>
              <div className="space-y-3">
                {[
                  { title: 'Use B-series VMs for non-intensive labs', saving: 'Up to 40%', impact: 'Low risk' },
                  { title: 'Enable auto-stop for idle VMs sooner', saving: 'Up to 20%', impact: 'Low risk' },
                  { title: 'Consider Spot VMs for trial labs', saving: 'Up to 60%', impact: 'Medium risk' },
                  { title: 'Scale down AKS nodes during off-peak', saving: 'Up to 25%', impact: 'Low risk' },
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
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
