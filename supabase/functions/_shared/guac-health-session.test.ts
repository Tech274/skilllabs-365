import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickHealthSession, type HealthSessionRow } from "./guac-health-session.ts";

const ownActive: HealthSessionRow = {
  id: "sess-own",
  user_id: "user-1",
  status: "active",
  guac_connection_id: "42",
  vm_id: "vm-1",
};

Deno.test("health fallback requires an active session with a connection id", () => {
  assertEquals(pickHealthSession({ byId: null, ownActive }).via, "vm_id_own");
  assertEquals(
    pickHealthSession({ byId: null, ownActive: { ...ownActive, status: "completed" } }).via,
    "none",
  );
  assertEquals(
    pickHealthSession({ byId: null, ownActive: { ...ownActive, guac_connection_id: null } }).via,
    "none",
  );
});

Deno.test("admins accept only the target session, never another user's latest", () => {
  const someoneElse: HealthSessionRow = {
    id: "sess-other",
    user_id: "user-2",
    status: "active",
    guac_connection_id: "99",
    vm_id: "vm-1",
  };
  // No admin-any-user input exists. A foreign row is visible only as the target session_id.
  const target = pickHealthSession({ byId: someoneElse, ownActive: null });
  assertEquals(target.via, "session_id");
  assertEquals(target.session?.id, "sess-other");
  assertEquals(pickHealthSession({ byId: null, ownActive: null }).via, "none");
});

Deno.test("connection-health source does not fall back to any user's latest", async () => {
  const src = await Deno.readTextFile(new URL("../guacamole-proxy/index.ts", import.meta.url));
  assertEquals(src.includes("vm_id_admin"), false);
  assertEquals(src.includes('resolvedVia = "vm_id_admin"'), false);
  const health = src.indexOf('action === "connection-health"');
  const create = src.indexOf('action === "create-session"');
  const slice = src.slice(health, create);
  assertEquals(slice.includes('.eq("status", "active")'), true);
  assertEquals(slice.includes("pickHealthSession("), true);
});
