import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_GUAC_PUBLIC_BY_PROVIDER,
  buildPublicIframeUrl,
  normalizeGuacCloudProvider,
  resolveGuacAdminEndpoint,
  resolveGuacPublicBase,
  toPublicIframeBase,
} from "./guac-hosts.ts";

function envFrom(map: Record<string, string>) {
  return { get: (k: string) => map[k] };
}

Deno.test("normalizeGuacCloudProvider maps aliases", () => {
  assertEquals(normalizeGuacCloudProvider("AWS"), "aws");
  assertEquals(normalizeGuacCloudProvider("amazon"), "aws");
  assertEquals(normalizeGuacCloudProvider("Azure"), "azure");
  assertEquals(normalizeGuacCloudProvider("az"), "azure");
  assertEquals(normalizeGuacCloudProvider("gcp"), "aws");
  assertEquals(normalizeGuacCloudProvider(""), "aws");
});

Deno.test("resolveGuacPublicBase defaults to locked hostnames", () => {
  const empty = envFrom({});
  assertEquals(resolveGuacPublicBase("aws", empty), DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);
  // Without GUACAMOLE_AZURE_URL, Azure pairs to AWS public host
  assertEquals(resolveGuacPublicBase("azure", empty), DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);
});

Deno.test("resolveGuacPublicBase uses Azure host once Azure admin URL is set", () => {
  const env = envFrom({ GUACAMOLE_AZURE_URL: "http://10.0.0.5:8080/guacamole" });
  assertEquals(resolveGuacPublicBase("azure", env), DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure);
  assertEquals(resolveGuacPublicBase("aws", env), DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);
});

Deno.test("resolveGuacPublicBase honours explicit env overrides", () => {
  const env = envFrom({
    GUACAMOLE_AWS_PUBLIC_URL: "https://guac-aws.example",
    GUACAMOLE_AZURE_PUBLIC_URL: "https://guac-az.example",
    GUACAMOLE_AZURE_URL: "http://ignored-for-public",
  });
  assertEquals(resolveGuacPublicBase("aws", env), "https://guac-aws.example");
  assertEquals(resolveGuacPublicBase("azure", env), "https://guac-az.example");
});

Deno.test("resolveGuacPublicBase falls back GUACAMOLE_PUBLIC_URL for AWS", () => {
  const env = envFrom({ GUACAMOLE_PUBLIC_URL: "https://legacy-guac.example" });
  assertEquals(resolveGuacPublicBase("aws", env), "https://legacy-guac.example");
});

Deno.test("resolveGuacAdminEndpoint Azure falls back to legacy admin vars", () => {
  const env = envFrom({
    GUACAMOLE_URL: "http://3.6.228.159:8080/guacamole",
    GUACAMOLE_ADMIN_USERNAME: "guacadmin",
    GUACAMOLE_ADMIN_PASSWORD: "secret",
  });
  const azure = resolveGuacAdminEndpoint("azure", env);
  assertEquals(azure.adminUrl, "http://3.6.228.159:8080/guacamole");
  assertEquals(azure.adminUsername, "guacadmin");
  assertEquals(azure.publicBase, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);

  const aws = resolveGuacAdminEndpoint("aws", env);
  assertEquals(aws.adminUrl, "http://3.6.228.159:8080/guacamole");
  assertEquals(aws.publicBase, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws);
});

Deno.test("resolveGuacAdminEndpoint prefers Azure-specific secrets", () => {
  const env = envFrom({
    GUACAMOLE_URL: "http://aws-guac:8080/guacamole",
    GUACAMOLE_ADMIN_USERNAME: "aws-admin",
    GUACAMOLE_ADMIN_PASSWORD: "aws-pass",
    GUACAMOLE_AZURE_URL: "http://azure-guac:8080/guacamole",
    GUACAMOLE_AZURE_ADMIN_USERNAME: "az-admin",
    GUACAMOLE_AZURE_ADMIN_PASSWORD: "az-pass",
  });
  const azure = resolveGuacAdminEndpoint("azure", env);
  assertEquals(azure.adminUrl, "http://azure-guac:8080/guacamole");
  assertEquals(azure.adminUsername, "az-admin");
  assertEquals(azure.adminPassword, "az-pass");
  assertEquals(azure.publicBase, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure);
});

Deno.test("toPublicIframeBase / buildPublicIframeUrl pick provider public host", () => {
  const api = "http://3.6.228.159:8080/guacamole";
  assertEquals(
    toPublicIframeBase(api, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws),
    "https://guac.skillhub365.co.in/guacamole",
  );
  assertEquals(
    toPublicIframeBase(api, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure),
    "https://guac-azure.skillhub365.co.in/guacamole",
  );
  assertEquals(
    buildPublicIframeUrl(api, DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure, "cid", "tok"),
    "https://guac-azure.skillhub365.co.in/guacamole/#/client/cid?token=tok",
  );
});
