// Admin-driven idempotent retry of provisioning / cancellation attempts.
//
// Two modes:
//  - "retry": re-runs the cancellation path for the recorded VM using the same
//    idempotency key, attributed to the operator who pressed the button.
//  - "reset": releases a stuck claim so the owning user's next attempt can run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeadersFor, errorResponse, jsonResponse, requireAdmin } from "../_shared/auth.ts";
import { ProvisioningTimeline, newCorrelationId } from "../_shared/provisioning-audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOURCE = "admin-retry";

const CANCEL_ACTIONS = new Set(["cancel-provisioning", "watchdog-cleanup"]);

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const recordId = typeof body.record_id === "string" ? body.record_id.trim() : "";
    const mode = body.mode === "reset" ? "reset" : "retry";
    if (!recordId) return errorResponse("record_id is required", 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: record } = await supabase
      .from("provisioning_idempotency")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();
    if (!record) return errorResponse("Retry record not found", 404);

    const correlationId = record.correlation_id ?? newCorrelationId();
    const timeline = new ProvisioningTimeline(supabase, {
      correlationId,
      userId: record.user_id,
      vmId: record.vm_id,
    });

    // Resolve the VM for cancel-style actions when the record predates vm_id.
    let vmId: string | null = record.vm_id ?? null;
    if (!vmId && record.correlation_id) {
      const { data: ev } = await supabase
        .from("provisioning_events")
        .select("vm_id")
        .eq("correlation_id", record.correlation_id)
        .not("vm_id", "is", null)
        .limit(1)
        .maybeSingle();
      vmId = ev?.vm_id ?? null;
    }

    const attempts = (record.attempts ?? 1) + 1;

    if (mode === "reset" || !CANCEL_ACTIONS.has(record.action)) {
      await supabase.from("provisioning_idempotency").delete().eq("id", recordId);
      await timeline.skipped(
        SOURCE,
        "retry",
        `Operator released the ${record.action} idempotency claim so it can run again`,
        { idempotency_key: record.idempotency_key, operator: auth.userId, attempts },
      );
      return jsonResponse({
        success: true,
        mode: "reset",
        action: record.action,
        correlation_id: correlationId,
        message: "Claim released — the next attempt for this action will execute.",
      });
    }

    if (!vmId) return errorResponse("No VM is linked to this record — use reset instead", 400);

    await timeline.start(SOURCE, "retry", `Operator retrying ${record.action}`, {
      idempotency_key: record.idempotency_key,
      operator: auth.userId,
      attempts,
    });

    // Free the previous claim so the retry is executed rather than replayed.
    await supabase.from("provisioning_idempotency").delete().eq("id", recordId);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/cleanup-idle-labs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        "x-correlation-id": correlationId,
        "idempotency-key": record.idempotency_key,
      },
      body: JSON.stringify({ action: "cancel-provisioning", vm_id: vmId }),
    });
    const payload = await res.json().catch(() => ({}));

    // Re-attribute the freshly created claim to the operator.
    await supabase
      .from("provisioning_idempotency")
      .update({
        attempts,
        actor_type: "admin",
        actor_id: auth.userId,
        vm_id: vmId,
        last_retried_at: new Date().toISOString(),
        last_retried_by: auth.userId,
        last_error: res.ok ? null : (payload?.error ?? `HTTP ${res.status}`),
      })
      .eq("idempotency_key", record.idempotency_key)
      .eq("action", "cancel-provisioning");

    if (!res.ok) {
      await timeline.failed(SOURCE, "retry", payload?.error ?? `Retry failed (HTTP ${res.status})`);
      return jsonResponse({ success: false, error: payload?.error ?? "Retry failed", correlation_id: correlationId }, 502);
    }

    await timeline.success(SOURCE, "retry", "Operator retry completed", { outcome: payload?.action ?? "cancelled" });
    return jsonResponse({ success: true, mode: "retry", correlation_id: correlationId, outcome: payload });
  } catch (e) {
    console.error("[provisioning-retry]", e);
    return errorResponse(e instanceof Error ? e.message : "Retry failed", 500);
  }
});
