import { describe, expect, it } from "vitest";
import { isTokenizedGuacUrl, toBrowserSafeGuacUrl } from "./guac-connect";
import { DEFAULT_GUAC_PUBLIC_BY_PROVIDER } from "./guac-public-hosts";

describe("isTokenizedGuacUrl", () => {
  it("accepts Guac client URL with token", () => {
    expect(
      isTokenizedGuacUrl("https://guac.example/#/client/abc123?token=secrettok"),
    ).toBe(true);
  });
  it("rejects bare Guac root (login wall)", () => {
    expect(isTokenizedGuacUrl("https://guac.example/")).toBe(false);
    expect(isTokenizedGuacUrl("https://guac.example/#/")).toBe(false);
  });
  it("rejects client path without token", () => {
    expect(isTokenizedGuacUrl("https://guac.example/#/client/abc")).toBe(false);
  });
});

describe("toBrowserSafeGuacUrl", () => {
  it("rewrites http IP:8080 Guac URL to AWS public HTTPS gateway by default", () => {
    const raw =
      "http://3.6.228.159:8080/guacamole/#/client/abc123?token=secrettok";
    expect(toBrowserSafeGuacUrl(raw)).toBe(
      "https://guac.skillhub365.co.in/guacamole/#/client/abc123?token=secrettok",
    );
  });

  it("rewrites private URL to Azure public host when provider is azure", () => {
    const raw =
      "http://10.0.0.5:8080/guacamole/#/client/abc123?token=secrettok";
    expect(toBrowserSafeGuacUrl(raw, "azure")).toBe(
      `${DEFAULT_GUAC_PUBLIC_BY_PROVIDER.azure}/guacamole/#/client/abc123?token=secrettok`,
    );
  });

  it("trusts proxy-returned AWS public HTTPS host without rewrite", () => {
    const raw =
      "https://guac.skillhub365.co.in/guacamole/#/client/abc123?token=secrettok";
    expect(toBrowserSafeGuacUrl(raw, "aws")).toBe(raw);
  });

  it("trusts proxy-returned Azure public HTTPS host without rewrite", () => {
    const raw =
      "https://guac-azure.skillhub365.co.in/guacamole/#/client/xyz?token=tok";
    expect(toBrowserSafeGuacUrl(raw, "azure")).toBe(raw);
  });
});
