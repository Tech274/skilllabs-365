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

Deno.test("cleanup-idle-labs exposes an owner-scoped cancel action only", async () => {
  const cleanup = await Deno.readTextFile(new URL("../cleanup-idle-labs/index.ts", import.meta.url));
  // Student path is gated by requireUser + requireOwnerOrAdmin.
  assert(cleanup.includes('action === "cancel-provisioning"'));
  assert(cleanup.includes("requireOwnerOrAdmin(auth, vm.user_id)"));
  // Every other action still requires admin.
  assert(cleanup.includes("await requireAdmin(req)"));
  // The obsolete action name must not come back.
  assertEquals(cleanup.includes("deallocate-vm"), false);
});
