/**
 * Remint-safe reuse rules for guacamole-proxy `create-session` (SCRUM-21).
 *
 * After Leave → Start (remint) the SPA must reach connection-health
 * `ready:true`. Two server paths could hand back a DEAD session instead of a
 * fresh one, so the gateway never reported an active tunnel:
 *
 *   1. Idempotent replay. A completed claim replays its stored response. When
 *      no Idempotency-Key header is sent, the key defaults to
 *      `guac-session:<vm_id>`, so every later Connect for that VM replayed the
 *      FIRST response, including its long-ended session, even after a remint.
 *   2. Live-session reuse. An `active` session row whose Guacamole connection
 *      still dials the pre-remint address (public IPs change on Stop→Start)
 *      got its password rotated and was reused, and the tunnel could not open.
 *
 * Pure helpers only, so both rules are unit-tested.
 */

/** A replayed create-session response is only safe while its session is still active. */
export function canReplayCreateSession(
  response: Record<string, unknown> | null | undefined,
  activeSessionIds: ReadonlyArray<string>,
): boolean {
  const sessionId = response && typeof response.session_id === "string" ? response.session_id.trim() : "";
  if (!sessionId) return false;
  const iframe = response && typeof response.iframe_url === "string" ? response.iframe_url : "";
  if (!iframe) return false;
  return activeSessionIds.includes(sessionId);
}

export type ConnectionParamsLookup =
  | { kind: "ok"; params: Record<string, unknown> }
  | { kind: "missing" } // gateway answered 404: connection definition is gone
  | { kind: "unknown" }; // gateway error / network: cannot tell

export type ReuseVerdict =
  | { reuse: true }
  | { reuse: false; reason: "connection_missing" | "dial_address_changed" };

/**
 * Reuse a live session only while its Guacamole connection still dials the
 * lab's CURRENT address. An unknown lookup keeps today's behaviour (reuse), so
 * a flaky gateway read never tears down a working desktop.
 */
export function liveSessionReuseVerdict(
  lookup: ConnectionParamsLookup,
  currentHostname: string,
): ReuseVerdict {
  if (lookup.kind === "missing") return { reuse: false, reason: "connection_missing" };
  if (lookup.kind === "unknown") return { reuse: true };
  const dialed = String(lookup.params.hostname ?? "").trim();
  const wanted = String(currentHostname ?? "").trim();
  if (!dialed || !wanted) return { reuse: true };
  return dialed === wanted ? { reuse: true } : { reuse: false, reason: "dial_address_changed" };
}
