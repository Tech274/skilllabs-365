// Downloadable provisioning audit export.
//
// Server-side authorization (admin or instructor only), server-side rendering
// of the JSON/CSV payload, and an audit row written for every download.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeadersFor, errorResponse, jsonResponse, requireRole } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Filters {
  correlation_id?: string;
  vm_id?: string;
  session_id?: string;
  lab_template_id?: string;
  from?: string;
  to?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_HEADERS = [
  "created_at", "correlation_id", "source", "step", "status", "message", "duration_ms",
  "vm_id", "session_id", "lab_template_id", "user_id",
  "idempotency_key", "idempotency_status", "cancellation_outcome", "attributed_to", "actor_type", "attempts", "last_error",
  "detail",
];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  return [
    EVENT_HEADERS.join(","),
    ...rows.map((r) => EVENT_HEADERS.map((h) => csvEscape(r[h])).join(",")),
  ].join("\n");
}

/** Cancellation outcome derived from the recorded steps of a correlation. */
function cancellationOutcome(steps: { step: string; status: string; message: string | null }[]): string {
  const cancels = steps.filter((s) => s.step === "cancel" || s.step === "azure-delete" || s.step === "cleanup");
  if (cancels.length === 0) return "";
  if (cancels.some((s) => s.status === "failed")) return "failed";
  if (cancels.some((s) => s.step === "cancel" && s.status === "skipped")) return "skipped_duplicate";
  if (cancels.some((s) => s.status === "success")) return "cancelled";
  return "in_progress";
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = await requireRole(req, ["admin", "super_admin", "content_admin", "instructor"]);
    if (auth instanceof Response) return auth;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const format = String(body.format ?? "json").toLowerCase() === "csv" ? "csv" : "json";
    const filters: Filters = {};
    for (const key of ["correlation_id", "vm_id", "session_id", "lab_template_id", "from", "to"] as const) {
      const raw = typeof body[key] === "string" ? (body[key] as string).trim() : "";
      if (raw) filters[key] = raw;
    }
    for (const key of ["vm_id", "session_id", "lab_template_id"] as const) {
      if (filters[key] && !UUID.test(filters[key]!)) return errorResponse(`${key} must be a UUID`, 400);
    }
    if (filters.correlation_id && !/^[A-Za-z0-9_.:-]{4,80}$/.test(filters.correlation_id)) {
      return errorResponse("correlation_id has an invalid format", 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let query = supabase
      .from("provisioning_events")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(5000);
    if (filters.correlation_id) query = query.eq("correlation_id", filters.correlation_id);
    if (filters.vm_id) query = query.eq("vm_id", filters.vm_id);
    if (filters.session_id) query = query.eq("session_id", filters.session_id);
    if (filters.lab_template_id) query = query.eq("lab_template_id", filters.lab_template_id);
    if (filters.from) query = query.gte("created_at", filters.from);
    if (filters.to) query = query.lte("created_at", filters.to);

    const { data: events, error } = await query;
    if (error) return errorResponse(error.message, 500);

    const rows = events ?? [];
    const correlationIds = [...new Set(rows.map((r) => r.correlation_id).filter(Boolean))];

    // Idempotency keys + operator/watchdog attribution for these correlations.
    const idemByCorrelation = new Map<string, Record<string, unknown>>();
    if (correlationIds.length) {
      const { data: idem } = await supabase
        .from("provisioning_idempotency")
        .select("idempotency_key, action, status, attempts, last_error, actor_type, actor_id, user_id, correlation_id, last_retried_by")
        .in("correlation_id", correlationIds.slice(0, 500));
      for (const row of idem ?? []) {
        if (row.correlation_id) idemByCorrelation.set(row.correlation_id, row);
      }
    }

    const stepsByCorrelation = new Map<string, { step: string; status: string; message: string | null }[]>();
    for (const r of rows) {
      const list = stepsByCorrelation.get(r.correlation_id) ?? [];
      list.push({ step: r.step, status: r.status, message: r.message });
      stepsByCorrelation.set(r.correlation_id, list);
    }

    const enriched = rows.map((r) => {
      const idem = idemByCorrelation.get(r.correlation_id);
      const watchdog = r.source === "labs-watchdog" || r.source === "cleanup-idle-labs" || idem?.actor_type === "watchdog";
      return {
        created_at: r.created_at,
        correlation_id: r.correlation_id,
        source: r.source,
        step: r.step,
        status: r.status,
        message: r.message,
        duration_ms: r.duration_ms,
        vm_id: r.vm_id,
        session_id: r.session_id,
        lab_template_id: r.lab_template_id,
        user_id: r.user_id,
        idempotency_key: idem?.idempotency_key ?? "",
        idempotency_status: idem?.status ?? "",
        cancellation_outcome: cancellationOutcome(stepsByCorrelation.get(r.correlation_id) ?? []),
        attributed_to: idem?.last_retried_by ?? idem?.actor_id ?? (watchdog ? "watchdog" : r.user_id ?? ""),
        actor_type: idem?.actor_type ?? (watchdog ? "watchdog" : "user"),
        attempts: idem?.attempts ?? "",
        last_error: idem?.last_error ?? "",
        detail: r.detail,
      };
    });

    // Audit every download attempt, including who and with what filters.
    await supabase.from("export_audit_logs").insert({
      actor_id: auth.userId,
      actor_email: auth.email,
      actor_role: auth.isServiceRole ? "service_role" : "admin_or_instructor",
      export_kind: "provisioning_events",
      format,
      filters,
      row_count: enriched.length,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    });

    if (format === "csv") {
      return new Response(toCsv(enriched), {
        headers: { ...cors, "Content-Type": "text/csv; charset=utf-8" },
      });
    }
    return jsonResponse({ rows: enriched, count: enriched.length, filters });
  } catch (e) {
    console.error("[provisioning-export]", e);
    return errorResponse(e instanceof Error ? e.message : "Export failed", 500);
  }
});
