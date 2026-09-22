import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyRdpGuacSecurityDefaults, rdpGuacSecurityParameters } from "./guac-rdp-params.ts";

Deno.test("RDP defaults are NLA plus ignore-cert", () => {
  assertEquals(rdpGuacSecurityParameters(), {
    "ignore-cert": "true",
    security: "nla",
  });
});

Deno.test("RDP defaults do not override an explicit security mode", () => {
  const parameters: Record<string, string> = { security: "tls" };
  applyRdpGuacSecurityDefaults(parameters);
  assertEquals(parameters.security, "tls");
  assertEquals(parameters["ignore-cert"], "true");
});
