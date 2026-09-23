import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  azurePublicIpName,
  azurePublicIpResourceId,
  buildAzureNicBody,
  buildAzurePublicIpBody,
  readArmIpAddress,
  readNicPrivateIp,
  readNicPublicIpRef,
} from "./azure-public-ip.ts";

const PIP_ID =
  "/subscriptions/sub/resourceGroups/skilllabs-rg/providers/Microsoft.Network/publicIPAddresses/lab-vm-pip";

Deno.test("buildAzurePublicIpBody is Standard static IPv4", () => {
  const body = buildAzurePublicIpBody("centralus");
  assertEquals(body.location, "centralus");
  assertEquals(body.sku, { name: "Standard" });
  const props = body.properties as Record<string, string>;
  assertEquals(props.publicIPAllocationMethod, "Static");
  assertEquals(props.publicIPAddressVersion, "IPv4");
});

Deno.test("buildAzureNicBody associates the public IP and marks it Delete with the NIC", () => {
  const body = buildAzureNicBody({
    region: "centralus",
    subnetId:
      "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet",
    publicIpId: PIP_ID,
  });
  const configs = (body.properties as {
    ipConfigurations: Array<{ properties: Record<string, unknown> }>;
  })
    .ipConfigurations;
  assertEquals(configs.length, 1);
  assertEquals(configs[0].properties.privateIPAllocationMethod, "Dynamic");
  assertEquals(configs[0].properties.publicIPAddress, {
    id: PIP_ID,
    properties: { deleteOption: "Delete" },
  });
});

Deno.test("azure public IP name and id follow the lab VM name", () => {
  assertEquals(
    azurePublicIpName("lab-69cdd8eb-muehhh5u"),
    "lab-69cdd8eb-muehhh5u-pip",
  );
  assertEquals(
    azurePublicIpResourceId("sub", "skilllabs-rg", "lab-69cdd8eb-muehhh5u"),
    "/subscriptions/sub/resourceGroups/skilllabs-rg/providers/Microsoft.Network/publicIPAddresses/lab-69cdd8eb-muehhh5u-pip",
  );
});

Deno.test("readArmIpAddress reads properties.ipAddress", () => {
  assertEquals(
    readArmIpAddress({ properties: { ipAddress: "20.25.10.4" } }),
    "20.25.10.4",
  );
  assertEquals(readArmIpAddress({ properties: { ipAddress: "  " } }), null);
  assertEquals(readArmIpAddress({ properties: {} }), null);
  assertEquals(readArmIpAddress(null), null);
});

Deno.test("readNicPrivateIp skips pending and reads the assigned address", () => {
  const nic = {
    properties: {
      ipConfigurations: [
        { properties: { privateIPAddress: "pending" } },
        { properties: { privateIPAddress: "172.18.0.55" } },
      ],
    },
  };
  assertEquals(readNicPrivateIp(nic), "172.18.0.55");
  assertEquals(
    readNicPrivateIp({ properties: { ipConfigurations: [] } }),
    null,
  );
});

Deno.test("readNicPublicIpRef prefers an inlined address and keeps the PIP id", () => {
  const nic = {
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
  };
  assertEquals(readNicPublicIpRef(nic), {
    resourceId: PIP_ID,
    address: "20.25.10.4",
  });
});

Deno.test("readNicPublicIpRef returns the id when Azure did not inline the address", () => {
  const nic = {
    properties: {
      ipConfigurations: [
        { properties: { publicIPAddress: { id: PIP_ID } } },
      ],
    },
  };
  assertEquals(readNicPublicIpRef(nic), { resourceId: PIP_ID, address: null });
});

Deno.test("readNicPublicIpRef is empty for a private-only NIC", () => {
  const nic = {
    properties: {
      ipConfigurations: [
        { properties: { privateIPAddress: "172.18.0.55" } },
      ],
    },
  };
  assertEquals(readNicPublicIpRef(nic), { resourceId: null, address: null });
});
