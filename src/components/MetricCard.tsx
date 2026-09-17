import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
}

const glowMap = {
  default: '',
  primary: 'glow-primary',
  success: 'glow-success',
  warning: 'glow-warning',
  destructive: 'glow-destructive',
};

const iconBgMap = {
  default: 'bg-secondary',
  primary: 'bg-primary/10',
  success: 'bg-success/10',
  warning: 'bg-warning/10',
  destructive: 'bg-destructive/10',
};

const iconColorMap = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

export function MetricCard({ title, value, subtitle, icon: Icon, trend, variant = 'default' }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 min-h-[108px]",
        glowMap[variant]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-h-[3.25rem]">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-semibold text-foreground font-mono">{value}</p>
          {/* Always reserve subtitle line so cards with/without subtitle share height */}
          <p className={cn("text-xs", subtitle ? "text-muted-foreground" : "invisible")}>
            {subtitle || "\u00A0"}
          </p>
          {trend && (
            <p className={cn("text-xs font-medium", trend.value > 0 ? "text-success" : "text-destructive")}>
              {trend.value > 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", iconBgMap[variant])}>
          <Icon className={cn("h-5 w-5", iconColorMap[variant])} />
        </div>
      </div>
    </motion.div>
  );
}
