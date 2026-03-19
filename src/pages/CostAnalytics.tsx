import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { DollarSign, TrendingDown, Calculator, Coins, Loader2, AlertTriangle, TrendingUp, CalendarDays, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AiInsightCard } from "@/components/AiInsightCard";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const COLORS = [
  'hsl(187 80% 48%)', 'hsl(210 80% 55%)', 'hsl(152 60% 45%)',
  'hsl(38 90% 55%)', 'hsl(280 60% 55%)', 'hsl(0 72% 55%)',
];

const VM_COST_PER_HOUR: Record<string, number> = {
  'Standard_B2s': 0.0416,
  'Standard_B2ms': 0.0832,
  'Standard_B4ms': 0.166,
  'Standard_D2s_v3': 0.096,
};

interface BudgetCap {
  enabled: boolean;
  period: string;
  amount: number;
}

export default function CostAnalytics() {
  const [loading, setLoading] = useState(true);
  const [costBreakdown, setCostBreakdown] = useState<{ category: string; cost: number; percentage: number }[]>([]);
  const [totalMonthly, setTotalMonthly] = useState(0);
  const [dailyTrend, setDailyTrend] = useState<{ day: string; cost: number }[]>([]);
  const [projectedMonthly, setProjectedMonthly] = useState(0);
  const [budgetCap, setBudgetCap] = useState<BudgetCap | null>(null);
  const [activeVmCount, setActiveVmCount] = useState(0);
  const [labCosts, setLabCosts] = useState<{ name: string; cost: number; hours: number }[]>([]);
  const [perLabAlert, setPerLabAlert] = useState<{ enabled: boolean; threshold: number } | null>(null);

  const fetchCostData = useCallback(async () => {
    const [vmRes, budgetRes, labRes, labAlertRes] = await Promise.all([
      supabase.from("virtual_machines").select("vm_size, status, created_at, lab_template_id"),
      supabase.from("platform_settings").select("value").eq("key", "budget_cap").maybeSingle(),
      supabase.from("lab_templates").select("id, name"),
      supabase.from("platform_settings").select("value").eq("key", "per_lab_cost_alert").maybeSingle(),
    ]);

    if (budgetRes.data?.value) setBudgetCap(budgetRes.data.value as any);
    if (labAlertRes.data?.value) setPerLabAlert(labAlertRes.data.value as any);

    const vms = vmRes.data;
    const labMap = new Map<string, string>();
    (labRes.data || []).forEach((l: any) => labMap.set(l.id, l.name));

    if (vms && vms.length > 0) {
      const sizeMap = new Map<string, number>();
      const now = Date.now();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      let monthlyTotal = 0;
      let active = 0;
      const dailyCosts = new Map<string, number>();
      const labCostMap = new Map<string, { cost: number; hours: number }>();

      for (const vm of vms) {
        const createdAt = new Date(vm.created_at).getTime();
        const hours = Math.max(1, (now - createdAt) / 3600000);
        const rate = VM_COST_PER_HOUR[vm.vm_size] || 0.05;
        const cost = hours * rate;
        sizeMap.set(vm.vm_size, (sizeMap.get(vm.vm_size) || 0) + cost);

        // Track cost per lab template
        const labName = (vm as any).lab_template_id ? (labMap.get((vm as any).lab_template_id) || "Unknown Lab") : "Unassigned";
        const existing = labCostMap.get(labName) || { cost: 0, hours: 0 };
        labCostMap.set(labName, { cost: existing.cost + cost, hours: existing.hours + hours });

        if (vm.status === "running" || vm.status === "idle") active++;

        if (createdAt >= monthStart) {
          monthlyTotal += cost;
          const day = new Date(vm.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          dailyCosts.set(day, (dailyCosts.get(day) || 0) + cost);
        }
      }

      setActiveVmCount(active);
      const totalCost = Array.from(sizeMap.values()).reduce((a, b) => a + b, 0);
      const breakdown = Array.from(sizeMap.entries()).map(([category, cost]) => ({
        category,
        cost: Math.round(cost * 100) / 100,
        percentage: totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0,
      })).sort((a, b) => b.cost - a.cost);

      setCostBreakdown(breakdown);
      setTotalMonthly(Math.round(monthlyTotal * 100) / 100);

      const dayOfMonth = new Date().getDate();
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const dailyAvg = dayOfMonth > 0 ? monthlyTotal / dayOfMonth : 0;
      setProjectedMonthly(Math.round(dailyAvg * daysInMonth * 100) / 100);

      const trend = Array.from(dailyCosts.entries())
        .map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 }))
        .sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
      setDailyTrend(trend);

      setLabCosts(
        Array.from(labCostMap.entries())
          .map(([name, v]) => ({ name, cost: Math.round(v.cost * 100) / 100, hours: Math.round(v.hours) }))
          .sort((a, b) => b.cost - a.cost)
      );
    } else {
      setCostBreakdown([]);
      setTotalMonthly(0);
      setProjectedMonthly(0);
      setDailyTrend([]);
      setLabCosts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  const budgetUsedPct = budgetCap?.enabled && budgetCap.amount > 0
    ? Math.min(100, Math.round((totalMonthly / budgetCap.amount) * 100))
    : null;

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
          costBreakdown.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No Cost Data"
              description="Cost analytics will appear here once VMs are provisioned. Costs are estimated based on VM sizes and uptime."
              hint="Tip: Launch a lab to start tracking infrastructure costs."
            />
          ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Month-to-Date" value={`$${totalMonthly.toLocaleString()}`} icon={DollarSign} variant="primary" />
              <MetricCard title="Projected Monthly" value={`$${projectedMonthly.toLocaleString()}`} icon={TrendingUp} variant={projectedMonthly > (budgetCap?.amount || Infinity) ? "warning" : "default"} subtitle="Based on daily average" />
              <MetricCard title="Active VMs" value={activeVmCount} icon={Calculator} variant="default" />
              <MetricCard title="VM Types" value={costBreakdown.length} icon={Coins} variant="default" subtitle="Distinct sizes in use" />
            </div>

            {/* Budget Cap Status */}
            {budgetCap?.enabled && budgetCap.amount > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl border p-5 ${budgetUsedPct! >= 90 ? "border-destructive/30 bg-destructive/5" : budgetUsedPct! >= 70 ? "border-warning/30 bg-warning/5" : "border-border bg-card"}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-medium text-foreground">
                      {budgetCap.period === "monthly" ? "Monthly" : "Daily"} Budget Cap
                    </h3>
                    <Badge variant="outline" className="text-[10px] font-mono">${budgetCap.amount}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {budgetUsedPct! >= 90 && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                    <span className={`text-sm font-mono font-semibold ${budgetUsedPct! >= 90 ? "text-destructive" : budgetUsedPct! >= 70 ? "text-warning" : "text-foreground"}`}>
                      {budgetUsedPct}% used
                    </span>
                  </div>
                </div>
                <Progress value={budgetUsedPct!} className="h-2.5" />
                <p className="text-xs text-muted-foreground mt-2">
                  ${totalMonthly.toFixed(2)} of ${budgetCap.amount} spent. {budgetUsedPct! >= 100 ? "New lab launches are paused." : `$${(budgetCap.amount - totalMonthly).toFixed(2)} remaining.`}
                </p>
              </motion.div>
            )}

            {/* Monthly Projection Chart */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">Daily Spend Trend (This Month)</h3>
                <span className="text-[10px] text-muted-foreground ml-auto font-mono">Projected: ${projectedMonthly}</span>
              </div>
              {dailyTrend.length > 1 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Spend']} />
                    <Area type="monotone" dataKey="cost" stroke="hsl(187 80% 48%)" fill="hsl(187 80% 48% / 0.15)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                  More data points needed for trend visualization.
                </div>
              )}
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-foreground mb-4">Cost by VM Size</h3>
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
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-foreground mb-4">Cost Breakdown</h3>
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
              </motion.div>
            </div>

            {/* Cost per Lab Template */}
            {labCosts.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Coins className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium text-foreground">Cost per Lab Template</h3>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(200, labCosts.length * 40)}>
                  <BarChart data={labCosts} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(215 12% 52%)' }} tickLine={false} axisLine={false} width={140} />
                    <Tooltip contentStyle={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 14% 18%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210 20% 92%)' }} formatter={(v: number, name: string) => [name === 'cost' ? `$${v.toFixed(2)}` : `${v}h`, name === 'cost' ? 'Cost' : 'Hours']} />
                    <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                      {labCosts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </motion.div>
            )}

            <AiInsightCard
              type="cost_insight"
              data={{ cost_breakdown: costBreakdown, total_monthly: totalMonthly, projected_monthly: projectedMonthly, budget_cap: budgetCap }}
              title="AI Cost Advisor"
              buttonLabel="Get Recommendations"
            />

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
          )
        )}
      </div>
    </DashboardLayout>
  );
}