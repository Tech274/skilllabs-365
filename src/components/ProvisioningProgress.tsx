import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Loader2, Server, Wifi, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProvisioningProgressProps {
  startedAt: number; // Date.now() when provisioning started
  estimatedSeconds?: number; // total estimated time (default 90s)
  className?: string;
}

const STAGES = [
  { label: "Creating VM", icon: Server, threshold: 0 },
  { label: "Configuring network", icon: Wifi, threshold: 35 },
  { label: "Starting OS", icon: Loader2, threshold: 65 },
  { label: "Ready soon", icon: CheckCircle2, threshold: 90 },
];

export function ProvisioningProgress({
  startedAt,
  estimatedSeconds = 90,
  className,
}: ProvisioningProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  // Progress caps at 95% until actually done
  const rawPct = Math.min((elapsed / estimatedSeconds) * 100, 95);
  const remaining = Math.max(estimatedSeconds - elapsed, 0);

  const currentStage = [...STAGES].reverse().find((s) => rawPct >= s.threshold) || STAGES[0];
  const StageIcon = currentStage.icon;

  const formatTime = (secs: number) => {
    if (secs <= 0) return "almost there...";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `~${m}m ${s}s remaining` : `~${s}s remaining`;
  };

  return (
    <div className={cn("space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StageIcon className={cn(
            "h-4 w-4 text-primary",
            currentStage.icon === Loader2 && "animate-spin"
          )} />
          <span className="text-sm font-medium text-foreground">{currentStage.label}</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{formatTime(remaining)}</span>
      </div>
      <Progress value={rawPct} className="h-2" />
      <div className="flex justify-between">
        {STAGES.map((stage, i) => (
          <div key={stage.label} className="flex flex-col items-center gap-1">
            <div className={cn(
              "h-2 w-2 rounded-full transition-colors",
              rawPct >= stage.threshold ? "bg-primary" : "bg-muted-foreground/30"
            )} />
            <span className={cn(
              "text-[9px] hidden sm:block",
              rawPct >= stage.threshold ? "text-primary font-medium" : "text-muted-foreground"
            )}>
              {stage.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
