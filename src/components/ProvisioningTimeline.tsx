import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";

export interface ProvisioningEvent {
  id: string;
  created_at: string;
  correlation_id: string;
  source: string;
  step: string;
  status: "running" | "success" | "failed" | "skipped";
  message: string | null;
  duration_ms: number | null;
  detail: Record<string, unknown> | null;
}

interface ProvisioningTimelineProps {
  /** Stream events for a VM... */
  vmId?: string | null;
  /** ...or for a single correlated request. */
  correlationId?: string | null;
  className?: string;
  limit?: number;
}

const STATUS_META = {
  running: { icon: Loader2, className: "text-primary animate-spin" },
  success: { icon: CheckCircle2, className: "text-primary" },
  failed: { icon: XCircle, className: "text-destructive" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground" },
} as const;

const STEP_LABELS: Record<string, string> = {
  auth: "Verifying access",
  preflight: "Checking Azure subscription",
  "vm-create": "Creating virtual machine",
  "subnet-resolve": "Resolving network subnet",
  "connectivity-check": "Checking remote access (SSH/RDP)",
  "azure-delete": "Removing Azure resources",
  "guacamole-connect": "Opening remote desktop",
  "session-end": "Ending session",
  cancel: "Cancelling lab",
  "credential-check": "Validating credentials",
  "resource-group": "Verifying resource group",
};

/** High-level lifecycle phases derived from the low-level step events. */
const PHASES = [
  { key: "queued", label: "Queued", steps: ["auth", "idempotency", "quota", "budget"] },
  { key: "provisioning", label: "Provisioning", steps: ["preflight", "credential-check", "resource-group", "subnet-resolve", "vm-create"] },
  { key: "booting", label: "Booting", steps: ["connectivity-check", "vm-status"] },
  { key: "ready", label: "Ready", steps: ["guacamole-connect", "ready"] },
] as const;

type PhaseState = { status: "pending" | "running" | "success" | "failed"; at: string | null };

export function derivePhases(events: ProvisioningEvent[]): Record<string, PhaseState> {
  const out: Record<string, PhaseState> = {};
  for (const phase of PHASES) {
    const matches = events.filter((e) => (phase.steps as readonly string[]).includes(e.step));
    if (!matches.length) { out[phase.key] = { status: "pending", at: null }; continue; }
    const last = matches[matches.length - 1];
    const failed = matches.some((e) => e.status === "failed");
    const running = !failed && matches.some((e) => e.status === "running")
      && !matches.some((e) => e.step === last.step && e.status === "success");
    out[phase.key] = {
      status: failed ? "failed" : running ? "running" : "success",
      at: last.created_at,
    };
  }
  return out;
}

function formatDuration(ms: number | null) {
  if (!ms && ms !== 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ProvisioningTimeline({ vmId, correlationId, className, limit = 40 }: ProvisioningTimelineProps) {
  const [events, setEvents] = useState<ProvisioningEvent[]>([]);

  useEffect(() => {
    if (!vmId && !correlationId) return;
    let active = true;

    const load = async () => {
      let query = supabase
        .from("provisioning_events")
        .select("id, created_at, correlation_id, source, step, status, message, duration_ms, detail")
        .order("created_at", { ascending: true })
        .limit(limit);
      query = correlationId ? query.eq("correlation_id", correlationId) : query.eq("vm_id", vmId!);
      const { data } = await query;
      if (active && data) setEvents(data as ProvisioningEvent[]);
    };

    load();

    const channel = supabase
      .channel(`provisioning-events-${correlationId ?? vmId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "provisioning_events",
          filter: correlationId ? `correlation_id=eq.${correlationId}` : `vm_id=eq.${vmId}`,
        },
        (payload) => {
          const row = payload.new as ProvisioningEvent;
          setEvents((prev) => (prev.some((e) => e.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [vmId, correlationId, limit]);

  if (events.length === 0) return null;

  const subnetId = events
    .map((e) => (e.detail as { subnet_id?: string } | null)?.subnet_id)
    .filter(Boolean)
    .pop() as string | undefined;
  const subnetSource = events
    .map((e) => (e.detail as { subnet_source?: string; source?: string } | null)?.subnet_source
      ?? (e.step === "subnet-resolve" ? (e.detail as { source?: string } | null)?.source : undefined))
    .filter(Boolean)
    .pop() as string | undefined;

  const phases = derivePhases(events);
  const lastError = [...events].reverse().find((e) => e.status === "failed");

  return (
    <div className={cn("space-y-3 rounded-lg border border-border/60 bg-card/50 p-4", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provisioning activity</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PHASES.map((phase) => {
          const state = phases[phase.key];
          const meta = state.status === "pending"
            ? { icon: CircleDashed, className: "text-muted-foreground/50" }
            : STATUS_META[state.status as keyof typeof STATUS_META];
          const Icon = meta.icon;
          return (
            <div key={phase.key}
              className={cn(
                "rounded-md border px-2 py-1.5",
                state.status === "failed" ? "border-destructive/40 bg-destructive/5"
                  : state.status === "pending" ? "border-border/40" : "border-border/60 bg-muted/30",
              )}>
              <div className="flex items-center gap-1.5">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.className)} />
                <span className="text-xs font-medium text-foreground">{phase.label}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {state.at ? new Date(state.at).toLocaleTimeString() : "—"}
              </p>
            </div>
          );
        })}
      </div>

      {lastError?.message && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">Last error</p>
          <p className="text-xs text-destructive">{lastError.message}</p>
        </div>
      )}
      <ol className="space-y-2">
        {events.map((event) => {
          const meta = STATUS_META[event.status] ?? { icon: CircleDashed, className: "text-muted-foreground" };
          const Icon = meta.icon;
          const duration = formatDuration(event.duration_ms);
          return (
            <li key={event.id} className="flex items-start gap-2 text-sm">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-foreground">{STEP_LABELS[event.step] ?? event.step}</span>
                  {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleTimeString()}
                  </span>
                </div>
                {event.message && (
                  <p className={cn("text-xs", event.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                    {event.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {subnetId && (
        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Subnet ARM ID{subnetSource ? ` (${subnetSource})` : ""}
          </p>
          <p className="break-all font-mono text-[11px] text-foreground">{subnetId}</p>
        </div>
      )}
      <p className="pt-1 font-mono text-[10px] text-muted-foreground">ref: {events[0].correlation_id}</p>
    </div>
  );
}
