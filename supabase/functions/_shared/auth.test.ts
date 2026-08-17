import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeadersFor, isAllowedOrigin } from "./auth.ts";

Deno.test("isAllowedOrigin allows lovable hosts and localhost", () => {
  assertEquals(isAllowedOrigin("https://skilllabs-365.lovable.app"), true);
  assertEquals(isAllowedOrigin("https://id-preview--abc.lovable.app"), true);
  assertEquals(isAllowedOrigin("https://foo.lovableproject.com"), true);
  assertEquals(isAllowedOrigin("http://localhost:8080"), true);
  assertEquals(isAllowedOrigin("http://127.0.0.1:5173"), true);
});

Deno.test("isAllowedOrigin rejects unknown and insecure origins", () => {
  assertEquals(isAllowedOrigin("https://evil.example.com"), false);
  assertEquals(isAllowedOrigin("http://evil.lovable.app"), false);
  assertEquals(isAllowedOrigin(""), false);
  assertEquals(isAllowedOrigin("not-a-url"), false);
});

Deno.test("isAllowedOrigin honours ALLOWED_ORIGINS", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://labs.example.com");
  assertEquals(isAllowedOrigin("https://labs.example.com"), true);
  Deno.env.delete("ALLOWED_ORIGINS");
  assertEquals(isAllowedOrigin("https://labs.example.com"), false);
});

Deno.test("corsHeadersFor never returns a wildcard", () => {
  const allowed = corsHeadersFor(
    new Request("https://x.test", { headers: { origin: "https://skilllabs-365.lovable.app" } }),
  );
  assertEquals(allowed["Access-Control-Allow-Origin"], "https://skilllabs-365.lovable.app");

  const denied = corsHeadersFor(
    new Request("https://x.test", { headers: { origin: "https://evil.example.com" } }),
  );
  assertEquals(denied["Access-Control-Allow-Origin"], "null");
  assertEquals(denied["Vary"], "Origin");
});
