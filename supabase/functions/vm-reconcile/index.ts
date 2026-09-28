// P2a — fleet / by-id reconcile of Hub VM rows against provider truth.
// POST { vm_ids?: uuid[], scope?: "fleet", dry_run?: bool }
// Auth: platform admin, service role, or x-cron-secret checked with cronSecretMatches
// against CRON_SHARED_SECRET (constant-time, not trimmed).
import { corsHeadersFor, requireAdmin, jsonResponse, errorResponse } from "../_shared/auth.ts";
import { cronSecretMatches } from "../_shared/cron-auth.ts";
import { serviceClient } from "../_shared/cloud-providers/accounts.ts";
import { effectiveReconcileDryRun, reconcileVms, VM_RECONCILE_COLS, type ReconcileVm } from "../_shared/vm-reconcile.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 100;
const FLEET_STATUSES = ["provisioning", "starting", "running", "idle", "stopped", "deallocated"];

export type VmReconcileDeps = {
  // deno-lint-ignore no-explicit-any -- test double or service client
  supabase?: any;
};

export async function handleVmReconcile(req: Request, deps?: VmReconcileDeps): Promise<Response> {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return errorResponse("POST only", 405);

  const isCron = cronSecretMatches(req.headers.get("x-cron-secret"));
  if (!isCron) {
    const auth = await requireAdmin(req); // accepts service role too
    if (auth instanceof Response) return auth;
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  // Default dry-run. Body dry_run:true forces a report. Body dry_run:false does
  // not enable writes; that requires VM_RECONCILE_MODE=apply or VM_RECONCILE_DRY_RUN=false.
  const dryRun = effectiveReconcileDryRun({ bodyDryRun: body.dry_run === true });

  const vmIds = body.vm_ids;
  if (vmIds !== undefined && (!Array.isArray(vmIds) || vmIds.some((v) => typeof v !== "string" || !UUID.test(v)))) {
    return errorResponse("vm_ids must be an array of UUIDs", 400);
  }
  if (!vmIds && body.scope !== "fleet") return errorResponse("Provide vm_ids or scope:\"fleet\"", 400);

  const admin = deps?.supabase ?? serviceClient();
  let q = admin.from("virtual_machines").select(VM_RECONCILE_COLS).not("azure_vm_id", "is", null);
  if (Array.isArray(vmIds)) {
    q = q.in("id", (vmIds as string[]).slice(0, MAX));
  } else {
    q = q.in("status", FLEET_STATUSES).order("updated_at", { ascending: true });
  }
  const { data: rows, error } = await q.limit(MAX);
  if (error) return errorResponse(error.message, 500);

  try {
    const results = await reconcileVms(admin, (rows ?? []) as ReconcileVm[], { source: "vm-reconcile", dryRun });
    return jsonResponse({
      checked: results.length,
      dry_run: dryRun,
      changed: results.filter((r) => r.changed).map((r) => ({
        vm_id: r.vm_id, before: r.before, after: r.after, cloud_state: r.cloud_state, provider: r.provider,
      })),
      protected_drift: results.filter((r) => r.code === "VM_PROTECTED_READONLY").map((r) => ({
        vm_id: r.vm_id, before: r.before, would_be: r.would_be, cloud_state: r.cloud_state,
      })),
      drift: results.filter((r) => r.would_be && r.code !== "VM_PROTECTED_READONLY").map((r) => ({
        vm_id: r.vm_id, code: r.code, before: r.before, would_be: r.would_be, cloud_state: r.cloud_state,
      })),
      errors: results.filter((r) => r.code === "VM_RECONCILE_CLOUD_UNAVAILABLE" || r.code === "VM_RECONCILE_WRITE_FAILED")
        .map((r) => ({ vm_id: r.vm_id, code: r.code })),
    });
  } catch (e) {
    console.error("vm-reconcile failed:", e);
    return errorResponse(e instanceof Error ? e.message : "reconcile failed", 500);
  }
}

// Skip the listener only when a test sets both flags. VM_RECONCILE_SKIP_SERVE
// alone must not stop a production or `supabase functions serve` process.
if (Deno.env.get("DENO_TESTING") !== "1" || Deno.env.get("VM_RECONCILE_SKIP_SERVE") !== "1") {
  Deno.serve((req) => handleVmReconcile(req));
}
