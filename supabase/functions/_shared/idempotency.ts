// Idempotency keys for provisioning-side effects.
//
// Repeated clicks, client retries and network replays must never create a
// second Azure VM or a duplicate Guacamole connection. Callers claim a key
// before doing work: the first claim wins ("new"), concurrent duplicates get
// "in_progress", and completed duplicates get the stored response back.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type ClaimResult =
  | { outcome: "new"; key: string }
  | { outcome: "in_progress"; key: string; correlationId: string | null }
  | { outcome: "replay"; key: string; response: Record<string, unknown>; correlationId: string | null };

/** Read the idempotency key from the header or body; generate one if absent. */
export function idempotencyKeyFrom(req: Request, body: Record<string, unknown>): string {
  const raw = (req.headers.get("idempotency-key") ?? (body?.idempotency_key as string | undefined) ?? "").trim();
  if (raw && raw.length <= 200) return raw;
  return crypto.randomUUID();
}

/** A killed edge run must not wedge the key forever. About five minutes. */
export const IDEMPOTENCY_IN_PROGRESS_TTL_MS = 5 * 60 * 1000;

export async function claimIdempotency(
  supabase: SupabaseClient,
  args: { key: string; userId: string; action: string; correlationId: string; now?: Date },
): Promise<ClaimResult> {
  const now = args.now ?? new Date();
  const insertRow = {
    idempotency_key: args.key,
    user_id: args.userId,
    action: args.action,
    correlation_id: args.correlationId,
    status: "in_progress" as const,
    created_at: now.toISOString(),
  };
  const { error } = await supabase.from("provisioning_idempotency").insert(insertRow);

  if (!error) return { outcome: "new", key: args.key };

  // 23505 = unique violation -> someone already claimed this key.
  if (error.code !== "23505") throw new Error(`Idempotency claim failed: ${error.message}`);

  const { data: existing } = await supabase
    .from("provisioning_idempotency")
    .select("status, response, correlation_id, created_at")
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .eq("idempotency_key", args.key)
    .maybeSingle();

  if (existing?.status === "completed") {
    return {
      outcome: "replay",
      key: args.key,
      response: (existing.response as Record<string, unknown>) ?? {},
      correlationId: existing.correlation_id ?? null,
    };
  }

  const createdMs = existing?.created_at ? Date.parse(String(existing.created_at)) : NaN;
  const stale = existing?.status === "in_progress"
    && Number.isFinite(createdMs)
    && now.getTime() - createdMs >= IDEMPOTENCY_IN_PROGRESS_TTL_MS;
  if (stale && existing?.created_at) {
    // Pin the delete to this exact stale row. A delete on status alone can
    // remove the row a concurrent retry just inserted, so both would get "new".
    const { data: removed, error: delErr } = await supabase
      .from("provisioning_idempotency")
      .delete()
      .eq("user_id", args.userId)
      .eq("action", args.action)
      .eq("idempotency_key", args.key)
      .eq("status", "in_progress")
      .eq("created_at", existing.created_at)
      .select("idempotency_key");
    if (delErr) throw new Error(`Idempotency reclaim failed: ${delErr.message}`);
    if (!removed || removed.length !== 1) {
      return { outcome: "in_progress", key: args.key, correlationId: existing.correlation_id ?? null };
    }
    const { error: reclaimed } = await supabase.from("provisioning_idempotency").insert(insertRow);
    if (!reclaimed) return { outcome: "new", key: args.key };
    if (reclaimed.code !== "23505") throw new Error(`Idempotency reclaim failed: ${reclaimed.message}`);
  }

  return { outcome: "in_progress", key: args.key, correlationId: existing?.correlation_id ?? null };
}

export async function completeIdempotency(
  supabase: SupabaseClient,
  args: { key: string; userId: string; action: string; response: Record<string, unknown> },
): Promise<void> {
  await supabase
    .from("provisioning_idempotency")
    .update({ status: "completed", response: args.response, completed_at: new Date().toISOString() })
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .eq("idempotency_key", args.key);
}

/** Release a claim so a genuine retry after a failure can run again. */
export async function releaseIdempotency(
  supabase: SupabaseClient,
  args: { key: string; userId: string; action: string },
): Promise<void> {
  await supabase
    .from("provisioning_idempotency")
    .delete()
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .eq("idempotency_key", args.key);
}

/**
 * Second line of defence, independent of the client-supplied key: a user may
 * only have one in-flight VM per lab template. Returns the existing VM row if
 * one is already provisioning/running for that template.
 */
export async function findInFlightVm(
  supabase: SupabaseClient,
  args: { userId: string; labTemplateId: string },
): Promise<{ id: string; status: string; azure_vm_id: string | null; private_ip: string | null } | null> {
  const { data } = await supabase
    .from("virtual_machines")
    .select("id, status, azure_vm_id, private_ip")
    .eq("user_id", args.userId)
    .eq("lab_template_id", args.labTemplateId)
    .in("status", ["provisioning", "running", "starting"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Drop a COMPLETED claim so a stale stored result can be re-minted (SCRUM-21
 * review follow-up). Unlike releaseIdempotency this never deletes an
 * `in_progress` claim, and when `correlationId` is given it only deletes the
 * exact stale row that was replayed. A concurrent request that already
 * re-claimed (or completed) the key is therefore left alone, so two parallel
 * Connects cannot both mint a session.
 */
export async function releaseCompletedIdempotency(
  supabase: SupabaseClient,
  args: { key: string; userId: string; action: string; correlationId?: string | null },
): Promise<void> {
  let q = supabase
    .from("provisioning_idempotency")
    .delete()
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .eq("idempotency_key", args.key)
    .eq("status", "completed");
  if (args.correlationId) q = q.eq("correlation_id", args.correlationId);
  await q;
}
