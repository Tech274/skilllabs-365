import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyPromoteToRunning,
  type AzureReconcileCtx,
  fetchNicAddresses,
  reconcileProvisioningAgainstAzure,
} from "./azure-reconcile.ts";

const CTX: AzureReconcileCtx = {
  token: "tok",
  subscriptionId: "sub",
  resourceGroup: "skilllabs-rg",
};

const VM_ID =
  "/subscriptions/sub/resourceGroups/skilllabs-rg/providers/Microsoft.Compute/virtualMachines/lab-vm";
const PIP_ID =
  "/subscriptions/sub/resourceGroups/skilllabs-rg/providers/Microsoft.Network/publicIPAddresses/lab-vm-pip";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("applyPromoteToRunning writes Azure public_ip in the same patch as running", async () => {
  let patch: Record<string, unknown> | null = null;
  const supabase = {
    from() {
      return {
        update(next: Record<string, unknown>) {
          patch = next;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  const ok = await applyPromoteToRunning(
    supabase,
    "vm-1",
    "172.18.0.55",
    "20.25.10.4",
  );
  assertEquals(ok, true);
  assertEquals(patch, {
    status: "running",
    private_ip: "172.18.0.55",
    public_ip: "20.25.10.4",
  });
});

Deno.test("applyPromoteToRunning does not clear public_ip when Azure has none yet", async () => {
  let patch: Record<string, unknown> | null = null;
  const supabase = {
    from() {
      return {
        update(next: Record<string, unknown>) {
          patch = next;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  await applyPromoteToRunning(supabase, "vm-1", "172.18.0.55", null);
  assertEquals(patch, { status: "running", private_ip: "172.18.0.55" });
  assertEquals(Object.prototype.hasOwnProperty.call(patch, "public_ip"), false);
});

Deno.test("fetchNicAddresses follows the PIP id when the NIC does not inline ipAddress", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/networkInterfaces/")) {
      return Promise.resolve(jsonResponse({
        properties: {
          ipConfigurations: [
            {
              properties: {
                privateIPAddress: "172.18.0.55",
                publicIPAddress: { id: PIP_ID },
              },
            },
          ],
        },
      }));
    }
    if (url.includes("/publicIPAddresses/")) {
      return Promise.resolve(
        jsonResponse({ properties: { ipAddress: "20.25.10.4" } }),
      );
    }
    return Promise.resolve(jsonResponse({ error: "unexpected" }, 404));
  };
  try {
    const addrs = await fetchNicAddresses(CTX, "lab-vm", null);
    assertEquals(addrs, {
      privateIp: "172.18.0.55",
      publicIp: "20.25.10.4",
      publicIpAttached: true,
    });
    assertEquals(urls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("reconcile promotes running with Hub public_ip from the associated PIP", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/instanceView")) {
      return Promise.resolve(jsonResponse({
        statuses: [{ code: "PowerState/running" }],
      }));
    }
    if (url.includes("/networkInterfaces/")) {
      return Promise.resolve(jsonResponse({
        properties: {
          ipConfigurations: [
            {
              properties: {
                privateIPAddress: "172.18.0.55",
                publicIPAddress: {
                  id: PIP_ID,
                  properties: { ipAddress: "20.25.10.4" },
                },
              },
            },
          ],
        },
      }));
    }
    return Promise.resolve(jsonResponse({ error: "unexpected" }, 404));
  };
  try {
    const outcome = await reconcileProvisioningAgainstAzure(CTX, {
      azureVmId: VM_ID,
      currentPrivateIp: null,
      publicIpRetryMs: 0,
    });
    assertEquals(outcome, {
      kind: "promoted",
      status: "running",
      private_ip: "172.18.0.55",
      public_ip: "20.25.10.4",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("reconcile of a private-only NIC promotes without inventing a public IP", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/instanceView")) {
      return Promise.resolve(
        jsonResponse({ statuses: [{ code: "PowerState/running" }] }),
      );
    }
    if (url.includes("/networkInterfaces/")) {
      return Promise.resolve(jsonResponse({
        properties: {
          ipConfigurations: [{
            properties: { privateIPAddress: "172.18.0.55" },
          }],
        },
      }));
    }
    return Promise.resolve(jsonResponse({ error: "unexpected" }, 404));
  };
  try {
    const outcome = await reconcileProvisioningAgainstAzure(CTX, {
      azureVmId: VM_ID,
      currentPrivateIp: "172.18.0.55",
      publicIpRetryMs: 0,
    });
    assertEquals(outcome, {
      kind: "promoted",
      status: "running",
      private_ip: "172.18.0.55",
      public_ip: null,
    });
  } finally {
    globalThis.fetch = original;
  }
});
