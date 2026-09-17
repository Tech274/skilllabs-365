import { describe, expect, it } from "vitest";
import { isTokenizedGuacUrl } from "./guac-connect";

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

import { toBrowserSafeGuacUrl } from "./guac-connect";

describe("toBrowserSafeGuacUrl", () => {
  it("rewrites http IP:8080 Guac URL to public HTTPS gateway", () => {
    const raw =
      "http://3.6.228.159:8080/guacamole/#/client/abc123?token=secrettok";
    expect(toBrowserSafeGuacUrl(raw)).toBe(
      "https://guac.skillhub365.co.in/guacamole/#/client/abc123?token=secrettok",
    );
  });
});
