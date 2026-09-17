import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUAC_PUBLIC_BY_PROVIDER,
  normalizeGuacCloudProvider,
  publicGuacBaseForProvider,
} from "./guac-public-hosts";

describe("guac-public-hosts", () => {
  it("locks AWS and Azure public hostnames", () => {
    expect(DEFAULT_GUAC_PUBLIC_BY_PROVIDER.aws).toBe("https://guac.skillhub365.co.in");
    expect(DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure).toBe(
      "https://guac-azure.skillhub365.co.in",
    );
  });

  it("selects public base by provider", () => {
    expect(publicGuacBaseForProvider("aws")).toBe("https://guac.skillhub365.co.in");
    expect(publicGuacBaseForProvider("azure")).toBe(
      "https://guac-azure.skillhub365.co.in",
    );
    expect(publicGuacBaseForProvider(undefined)).toBe("https://guac.skillhub365.co.in");
  });

  it("normalizes provider aliases", () => {
    expect(normalizeGuacCloudProvider("Azure")).toBe("azure");
    expect(normalizeGuacCloudProvider("AWS")).toBe("aws");
    expect(normalizeGuacCloudProvider("gcp")).toBe("aws");
  });
});
