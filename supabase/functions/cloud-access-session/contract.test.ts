// Regression guard for the auth-context shape used by cloud-access-session.
// `requireUser` returns { supabase, userId, email, isServiceRole } — never a
// `user` object. `deno check` catches type errors, this test catches the
// pattern coming back through copy/paste.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("cloud-access-session destructures userId from the auth context", () => {
  assert(source.includes("const { userId, supabase } = auth;"));
});

Deno.test("cloud-access-session never dereferences auth.user", () => {
  assertEquals(/\buser\.id\b/.test(source), false);
  assertEquals(/const \{[^}]*\buser\b[^}]*\} = auth;/.test(source), false);
});

Deno.test("cloud-access-session rejects service-role callers for user actions", () => {
  assert(source.includes("auth.isServiceRole"));
});

Deno.test("cleanup-idle-labs exposes owner-scoped learner actions", async () => {
  const cleanup = await Deno.readTextFile(new URL("../cleanup-idle-labs/index.ts", import.meta.url));
  // Student paths are gated by requireUser + requireOwnerOrAdmin.
  assert(cleanup.includes('action === "cancel-provisioning"'));
  assert(cleanup.includes('action === "learner-leave"'));
  assert(cleanup.includes("requireOwnerOrAdmin(auth, vm.user_id)"));
  // Every other action still requires admin.
  assert(cleanup.includes("await requireAdmin(req)"));
  // The obsolete action name must not come back.
  assertEquals(cleanup.includes("deallocate-vm"), false);
  // Soft-stop Leave must never hard-delete.
  assert(cleanup.includes('endedReason: "learner_leave"'));
  assert(cleanup.includes("ended_reason: opts.endedReason"));
  assertEquals(cleanup.includes('action === "manual-stop"'), false);
  // Leave honesty: Hub deallocated only when cloud_stop_ok (or reconcile) succeeds.
  assert(cleanup.includes("cloud_stop_ok: stopped"));
  assert(cleanup.includes("isCloudAlreadySoftStopped"));
  assert(cleanup.includes("Honesty gate: Hub deallocated ONLY when cloud soft-stop"));
  // SCRUM-106: learner cancel of an existing allocation soft-stops, never deletes.
  assert(cleanup.includes("decideLearnerCancel("));
  assert(cleanup.includes('action: "cancel-soft-stopped"'));
  const softIdx = cleanup.indexOf('cancelDecision.mode === "soft_stop"');
  const deleteIdx = cleanup.indexOf("await deleteCloudVm(supabase, azureFor, vm);");
  assert(softIdx > 0 && deleteIdx > softIdx, "soft-stop branch must run before the cancel hard-delete");
  // Review follow-up: any session (active or ended) counts; persistence checked;
  // admin hard delete needs an explicit force_delete; failed stop is retried by cron.
  assertEquals(cleanup.includes('.not("ended_at", "is", null);\n        completedSessions'), false);
  assert(cleanup.includes("priorSessions = countErr ? 1 : (count ?? 0);"));
  assert(cleanup.includes('.select("is_persistent")'));
  assert(cleanup.includes("rawBody.force_delete === true"));
  assert(cleanup.includes("ended_reason: CANCEL_PENDING_STOP_REASON"));
  assert(cleanup.includes("ended_reason.like.${CANCEL_PENDING_STOP_REASON}*"));
  // Riley #58: capped retries + admin-visible failures + Start takes the Cancel back.
  assert(cleanup.includes("await recordStopFailure(supabase, vm, retry, {"));
  assert(cleanup.includes('pass: "idle",'));
  assert(cleanup.includes("isLearnerResumablePendingStop(status,"));
  assert(cleanup.includes('action: "resumed-pending-stop"'));
});
