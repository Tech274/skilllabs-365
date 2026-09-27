import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canReplayCreateSession, liveSessionReuseVerdict } from "./guac-session-reuse.ts";

const replay = { session_id: "s-1", iframe_url: "https://guac.example/#/client/abc?token=t" };

Deno.test("replay allowed only while its session is still active", () => {
  assertEquals(canReplayCreateSession(replay, ["s-1"]), true);
  assertEquals(canReplayCreateSession(replay, ["s-2"]), false);
  assertEquals(canReplayCreateSession(replay, []), false);
});

Deno.test("replay without session_id or iframe_url is never reused", () => {
  assertEquals(canReplayCreateSession({ iframe_url: replay.iframe_url }, ["s-1"]), false);
  assertEquals(canReplayCreateSession({ session_id: "s-1" }, ["s-1"]), false);
  assertEquals(canReplayCreateSession(null, ["s-1"]), false);
  assertEquals(canReplayCreateSession({ session_id: "  " , iframe_url: "x" }, ["  "]), false);
});

Deno.test("reuse when the connection still dials the current address", () => {
  assertEquals(
    liveSessionReuseVerdict({ kind: "ok", params: { hostname: "3.110.1.2", port: "3389" } }, "3.110.1.2"),
    { reuse: true },
  );
});

Deno.test("remint changed the public IP → do not reuse", () => {
  assertEquals(
    liveSessionReuseVerdict({ kind: "ok", params: { hostname: "3.110.1.2" } }, "13.232.9.9"),
    { reuse: false, reason: "dial_address_changed" },
  );
});

Deno.test("connection definition gone → do not reuse", () => {
  assertEquals(liveSessionReuseVerdict({ kind: "missing" }, "10.0.0.4"), {
    reuse: false,
    reason: "connection_missing",
  });
});

Deno.test("unknown lookup or blank values keep today's reuse", () => {
  assertEquals(liveSessionReuseVerdict({ kind: "unknown" }, "10.0.0.4"), { reuse: true });
  assertEquals(liveSessionReuseVerdict({ kind: "ok", params: {} }, "10.0.0.4"), { reuse: true });
  assertEquals(liveSessionReuseVerdict({ kind: "ok", params: { hostname: "10.0.0.4" } }, ""), { reuse: true });
});
