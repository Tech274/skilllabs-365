// Central admin audit trail: resource provider changes and launch outcomes.
//
// Rows land in public.admin_audit_logs (admin-readable, service-role writable).

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorType?: "user" | "system" | "watchdog" | "cron";
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  outcome?: "success" | "failed" | "blocked" | "already_running" | "start_accepted" | "running";
  changes?: Record<string, unknown>;
  message?: string | null;
  correlationId?: string | null;
}

/** Shallow diff of two objects, redacting anything secret-looking. */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> {
  const SECRET = /(secret|password|token|key_json|access_key)/i;
  const redact = (k: string, v: unknown) => (SECRET.test(k) ? (v ? "«set»" : null) : v);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const a = (before ?? {})[key];
    const b = (after ?? {})[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[key] = { from: redact(key, a), to: redact(key, b) };
  }
  return out;
}

export async function recordAudit(
  // deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
  admin: any,
  entry: AuditEntry,
): Promise<void> {
  try {
    let email = entry.actorEmail ?? null;
    if (!email && entry.actorId) {
      const { data } = await admin
        .from("profiles").select("email").eq("user_id", entry.actorId).maybeSingle();
      email = data?.email ?? null;
    }
    await admin.from("admin_audit_logs").insert({
      actor_id: entry.actorId ?? null,
      actor_email: email,
      actor_type: entry.actorType ?? "user",
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      outcome: entry.outcome ?? "success",
      changes: entry.changes ?? {},
      message: entry.message ? String(entry.message).slice(0, 1000) : null,
      correlation_id: entry.correlationId ?? null,
    });
  } catch (e) {
    console.error("admin audit write failed:", e instanceof Error ? e.message : e);
  }
}
