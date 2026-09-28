/**
 * connection-health session pick.
 *
 * The target session_id wins. A vm_id fallback is only this user's latest
 * ACTIVE row. Admins are not offered another user's latest session — the
 * caller must not pass a foreign row as `ownActive`.
 */
export interface HealthSessionRow {
  id: string;
  user_id: string;
  status: string;
  guac_connection_id: string | null;
  vm_id: string | null;
}

export function pickHealthSession(args: {
  byId: HealthSessionRow | null;
  ownActive: HealthSessionRow | null;
}): { session: HealthSessionRow | null; via: "session_id" | "vm_id_own" | "none" } {
  if (args.byId) return { session: args.byId, via: "session_id" };
  const own = args.ownActive;
  if (own && own.status === "active" && own.guac_connection_id && own.vm_id) {
    return { session: own, via: "vm_id_own" };
  }
  return { session: null, via: "none" };
}
