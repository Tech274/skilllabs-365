import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectConfigIssue, verifyAzureSubscription } from "./azure-preflight.ts";

Deno.test("detectConfigIssue maps SubscriptionNotFound to the subscription setting", () => {
  const issue = detectConfigIssue(
    `{"error":{"code":"SubscriptionNotFound","message":"The subscription could not be found."}}`,
    { subscriptionId: "dbc298f2-0000-0000-0000-000000000000" },
  );
  assertEquals(issue?.setting, "AZURE_SUBSCRIPTION_ID");
  assertStringIncludes(issue!.suggestion, "dbc298f2");
});

Deno.test("detectConfigIssue maps other Azure config errors", () => {
  assertEquals(detectConfigIssue("AuthorizationFailed").setting, "AZURE_CLIENT_ID / role assignment");
  assertEquals(detectConfigIssue("ResourceGroupNotFound", { resourceGroup: "rg" })?.setting, "AZURE_RESOURCE_GROUP");
  assertEquals(detectConfigIssue("AADSTS7000215 invalid_client")?.setting, "AZURE_CLIENT_SECRET");
  assertEquals(detectConfigIssue("MissingSubscriptionRegistration")?.setting, "Azure resource providers");
  assertEquals(detectConfigIssue("some unrelated failure"), null);
});

Deno.test("verifyAzureSubscription fails fast without a subscription id", async () => {
  const res = await verifyAzureSubscription({ token: "t" });
  assertEquals(res.ok, false);
  assertEquals(res.setting, "AZURE_SUBSCRIPTION_ID");
});

Deno.test("verifyAzureSubscription reports SubscriptionNotFound with the id", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { code: "SubscriptionNotFound", message: "not found" } }), { status: 404 }),
    ) as unknown as Promise<Response>;
  try {
    const res = await verifyAzureSubscription({ token: "t", subscriptionId: "sub-123" });
    assertEquals(res.ok, false);
    assertEquals(res.step, "subscription");
    assertEquals(res.code, "SubscriptionNotFound");
    assertEquals(res.setting, "AZURE_SUBSCRIPTION_ID");
    assertStringIncludes(res.message, "sub-123");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("verifyAzureSubscription passes when subscription and rg resolve", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ state: "Enabled", displayName: "Labs" }), { status: 200 }),
    ) as unknown as Promise<Response>;
  try {
    const res = await verifyAzureSubscription({ token: "t", subscriptionId: "sub-123", resourceGroup: "rg" });
    assertEquals(res.ok, true);
    assertStringIncludes(res.message, "Labs");
  } finally {
    globalThis.fetch = original;
  }
});
