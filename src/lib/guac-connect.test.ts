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
