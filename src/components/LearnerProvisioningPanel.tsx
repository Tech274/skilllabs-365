import { useEffect, useState } from "react";
import { Loader2, Sparkles, MessageCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HUB_WHATSAPP_UPSELL } from "@/lib/skilltrack-handoff";
import { LEARNER_PROVISION_TIPS, learnerFailureCopy } from "@/lib/learner-provisioning";
import { derivePhases, type ProvisioningEvent } from "@/components/ProvisioningTimeline";
import { supabase } from "@/integrations/supabase/client";

interface LearnerProvisioningPanelProps {
  mode: "preparing" | "failed";
  startedAt?: number | null;
  estimatedSeconds?: number;
  vmId?: string | null;
  /** Optional raw error — sanitized before display. */
  errorMessage?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  className?: string;
}

const PHASE_ORDER = ["queued", "provisioning", "booting", "ready"] as const;
const PHASE_LABELS: Record<(typeof PHASE_ORDER)[number], string> = {
  queued: "Queued",
  provisioning: "Setting up",
  booting: "Starting",
  ready: "Almost ready",
};

export function LearnerProvisioningPanel({
  mode,
  startedAt,
  estimatedSeconds = 90,
  vmId,
  errorMessage,
  onRetry,
  onBack,
  onCancel,
  cancelling,
  className,
}: LearnerProvisioningPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [events, setEvents] = useState<ProvisioningEvent[]>([]);
  const tip = LEARNER_PROVISION_TIPS[Math.floor(elapsed / 30) % LEARNER_PROVISION_TIPS.length];

  useEffect(() => {
    if (!startedAt || mode !== "preparing") return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, mode]);

  useEffect(() => {
    if (!vmId || mode !== "preparing") return;
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("provisioning_events")
        .select("id, created_at, correlation_id, source, step, status, message, duration_ms, detail")
        .eq("vm_id", vmId)
        .order("created_at", { ascending: true })
        .limit(40);
      if (active && data) setEvents(data as ProvisioningEvent[]);
    };
    load();
    const channel = supabase
      .channel(`learner-provision-${vmId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "provisioning_events", filter: `vm_id=eq.${vmId}` },
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
  }, [vmId, mode]);

  if (mode === "failed") {
    const copy = learnerFailureCopy(errorMessage);
    return (
      <div className={cn("mx-auto w-full max-w-md space-y-5 text-center", className)}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
          <Sparkles className="h-7 w-7 text-warning" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.detail}</p>
          <p className="text-xs text-muted-foreground/90">{copy.tip}</p>
          <p className="text-[11px] font-medium text-primary/90">Ops has been notified.</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onBack && (
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Labs
            </Button>
          )}
          {onRetry && (
            <Button onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          )}
          <Button variant="secondary" asChild>
            <a href={HUB_WHATSAPP_UPSELL} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4" />
              WhatsApp Ops
            </a>
          </Button>
        </div>
      </div>
    );
  }

  const phases = derivePhases(events);
  const activeIdx = (() => {
    let idx = 0;
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const st = phases[PHASE_ORDER[i]]?.status;
      if (st === "running" || st === "failed") return i;
      if (st === "success") idx = Math.min(i + 1, PHASE_ORDER.length - 1);
    }
    // Fall back to time-based stage when no events yet
    if (events.length === 0 && startedAt) {
      const pct = Math.min((elapsed / estimatedSeconds) * 100, 95);
      if (pct >= 90) return 3;
      if (pct >= 65) return 2;
      if (pct >= 35) return 1;
      return 0;
    }
    return idx;
  })();

  const rawPct = startedAt
    ? Math.min((elapsed / estimatedSeconds) * 100, 95)
    : Math.min(((activeIdx + 1) / PHASE_ORDER.length) * 100, 90);
  const remaining = startedAt ? Math.max(estimatedSeconds - elapsed, 0) : null;
  const etaLabel =
    remaining == null
      ? "Getting ready…"
      : remaining <= 0
        ? "Almost there…"
        : remaining >= 60
          ? `About ${Math.ceil(remaining / 60)} min left`
          : `About ${remaining}s left`;

  return (
    <div className={cn("mx-auto w-full max-w-md space-y-5 text-center", className)}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">Your lab is getting ready…</h2>
        <p className="text-sm text-muted-foreground">
          We&apos;re preparing a secure desktop for you. This usually takes a minute or two.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{PHASE_LABELS[PHASE_ORDER[activeIdx]]}</span>
          <span className="text-xs font-mono text-muted-foreground">{etaLabel}</span>
        </div>
        <Progress value={rawPct} className="h-2" />
        <div className="flex justify-between pt-1">
          {PHASE_ORDER.map((key, i) => (
            <span
              key={key}
              className={cn(
                "text-[10px]",
                i <= activeIdx ? "font-medium text-primary" : "text-muted-foreground",
              )}
            >
              {PHASE_LABELS[key]}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">Tip: </span>
        {tip}
      </p>

      {(onCancel || onBack) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back to Labs
            </Button>
          )}
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
