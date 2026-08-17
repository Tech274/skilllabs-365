// Provisioning audit timeline.
//
// Every provisioning-related edge function step (preflight, VM create,
// Guacamole connect, cancellation, cleanup) is written to
// public.provisioning_events with a correlation id so the UI can stream a live
// timeline and support can correlate a user report with function logs.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type StepStatus = "running" | "success" | "failed" | "skipped";

export interface TimelineContext {
  correlationId: string;
  userId?: string | null;
  vmId?: string | null;
  sessionId?: string | null;
  labTemplateId?: string | null;
}

/** Correlation id: caller-provided (`x-correlation-id`) or freshly minted. */
export function correlationIdFrom(req: Request): string {
  const header = req.headers.get("x-correlation-id")?.trim();
  if (header && /^[A-Za-z0-9_.:-]{8,80}$/.test(header)) return header;
  return newCorrelationId();
}

export function newCorrelationId(): string {
  return `prv_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Values that must never land in the audit detail payload. */
const SENSITIVE_KEYS = /pass(word)?|secret|token|key|credential|authorization/i;

export function sanitizeDetail(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string") {
      out[k] = v.length > 500 ? `${v.slice(0, 500)}…` : v;
    } else if (v && typeof v === "object") {
      out[k] = sanitizeDetail(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class ProvisioningTimeline {
  private ctx: TimelineContext;
  private stepStart = new Map<string, number>();

  constructor(private supabase: SupabaseClient, ctx: TimelineContext) {
    this.ctx = { ...ctx };
  }

  get correlationId(): string {
    return this.ctx.correlationId;
  }

  /** Attach ids discovered mid-flight (vm row, session row, template). */
  attach(patch: Partial<TimelineContext>): void {
    this.ctx = { ...this.ctx, ...patch };
  }

  private async write(
    source: string,
    step: string,
    status: StepStatus,
    message?: string,
    detail?: unknown,
    durationMs?: number,
  ): Promise<void> {
    try {
      await this.supabase.from("provisioning_events").insert({
        correlation_id: this.ctx.correlationId,
        user_id: this.ctx.userId ?? null,
        vm_id: this.ctx.vmId ?? null,
        session_id: this.ctx.sessionId ?? null,
        lab_template_id: this.ctx.labTemplateId ?? null,
        source,
        step,
        status,
        message: message ?? null,
        detail: sanitizeDetail(detail),
        duration_ms: durationMs ?? null,
      });
    } catch (e) {
      // Auditing must never break provisioning.
      console.error("[timeline] insert failed:", e instanceof Error ? e.message : e);
    }
  }

  async start(source: string, step: string, message?: string, detail?: unknown): Promise<void> {
    this.stepStart.set(step, Date.now());
    await this.write(source, step, "running", message, detail);
  }

  async success(source: string, step: string, message?: string, detail?: unknown): Promise<void> {
    await this.write(source, step, "success", message, detail, this.elapsed(step));
  }

  async failed(source: string, step: string, message?: string, detail?: unknown): Promise<void> {
    await this.write(source, step, "failed", message, detail, this.elapsed(step));
  }

  async skipped(source: string, step: string, message?: string, detail?: unknown): Promise<void> {
    await this.write(source, step, "skipped", message, detail, this.elapsed(step));
  }

  private elapsed(step: string): number | undefined {
    const started = this.stepStart.get(step);
    if (started === undefined) return undefined;
    this.stepStart.delete(step);
    return Date.now() - started;
  }
}

/** Response headers that let the client follow the timeline it just triggered. */
export function correlationHeaders(correlationId: string): Record<string, string> {
  return { "x-correlation-id": correlationId };
}
