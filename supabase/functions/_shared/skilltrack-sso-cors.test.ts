import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ssoCorsGate } from "./skilltrack-sso-cors.ts";

const r = (method: string, origin?: string) =>
  new Request("https://x.supabase.co/functions/v1/skilltrack-sso-exchange", {
    method,
    headers: origin ? { origin } : {},
  });

Deno.test("SSO CORS: only https://skillhub365.co.in, even if ALLOWED_ORIGINS lists others", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://labs.example.com");
  try {
    const bad = ssoCorsGate(r("POST", "https://labs.example.com"))!;
    assertEquals(bad.status, 403);
    assertEquals(bad.headers.get("access-control-allow-origin"), null);
    assertEquals(ssoCorsGate(r("POST", "https://abc.lovable.app"))!.status, 403);
    assertEquals(ssoCorsGate(r("POST"))!.status, 403);
    const pre = ssoCorsGate(r("OPTIONS", "https://skillhub365.co.in"))!;
    assertEquals(pre.status, 204);
    assertEquals(pre.headers.get("access-control-allow-origin"), "https://skillhub365.co.in");
    assertEquals(ssoCorsGate(r("POST", "https://skillhub365.co.in")), null);
  } finally {
    Deno.env.delete("ALLOWED_ORIGINS");
  }
});
