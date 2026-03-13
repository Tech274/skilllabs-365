import { cn } from "@/lib/utils";
import type { VMStatus } from "@/lib/types";

const statusConfig: Record<VMStatus, { label: string; dotClass: string; bgClass: string }> = {
  running: { label: 'Running', dotClass: 'bg-success', bgClass: 'bg-success/10 text-success' },
  idle: { label: 'Idle', dotClass: 'bg-warning', bgClass: 'bg-warning/10 text-warning' },
  provisioning: { label: 'Provisioning', dotClass: 'bg-info animate-pulse', bgClass: 'bg-info/10 text-info' },
  starting: { label: 'Starting', dotClass: 'bg-primary animate-pulse', bgClass: 'bg-primary/10 text-primary' },
  expired: { label: 'Expired', dotClass: 'bg-destructive', bgClass: 'bg-destructive/10 text-destructive' },
  stopped: { label: 'Stopped', dotClass: 'bg-muted-foreground', bgClass: 'bg-muted text-muted-foreground' },
  deallocated: { label: 'Deallocated', dotClass: 'bg-muted-foreground', bgClass: 'bg-muted text-muted-foreground' },
  terminated: { label: 'Terminated', dotClass: 'bg-destructive', bgClass: 'bg-destructive/10 text-destructive' },
  failed: { label: 'Failed', dotClass: 'bg-destructive animate-pulse', bgClass: 'bg-destructive/10 text-destructive' },
};

export function StatusBadge({ status }: { status: VMStatus }) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", config.bgClass)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)} />
      {config.label}
    </span>
  );
}
