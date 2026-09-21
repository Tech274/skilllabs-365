import { describe, expect, it } from "vitest";
import { formatFunctionError, readFunctionErrorPayload } from "@/lib/function-error";

describe("formatFunctionError", () => {
  it("always surfaces detail code and aws_state", () => {
    const msg = formatFunctionError(
      {
        error: "Cloud start rejected",
        code: "GHOST_INSTANCE",
        detail: "InvalidInstanceID.NotFound: instance i-0dd83d48a728880c5 does not exist",
        aws_state: "not-found",
        provider: "aws",
      },
      null,
    );
    expect(msg).toContain("Cloud start rejected");
    expect(msg).toContain("GHOST_INSTANCE");
    expect(msg).toContain("InvalidInstanceID.NotFound");
    expect(msg).toContain("aws_state=not-found");
    expect(msg).toContain("provider=aws");
  });

  it("formats when error field missing but detail present", () => {
    const msg = formatFunctionError(
      { detail: "boom", code: "CLOUD_START_REJECTED", aws_state: "stopped" },
      null,
    );
    expect(msg).toContain("CLOUD_START_REJECTED");
    expect(msg).toContain("boom");
    expect(msg).toContain("aws_state=stopped");
  });
});

describe("readFunctionErrorPayload", () => {
  it("merges data with Response context body", async () => {
    const body = {
      error: "Cloud start rejected",
      code: "GHOST_INSTANCE",
      detail: "InvalidInstanceID.NotFound",
      aws_state: "not-found",
    };
    const ctx = new Response(JSON.stringify(body), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
    const payload = await readFunctionErrorPayload({ context: ctx, message: "Edge Function returned a non-2xx status code" }, null);
    expect(payload?.code).toBe("GHOST_INSTANCE");
    expect(payload?.detail).toContain("InvalidInstanceID");
    expect(payload?.aws_state).toBe("not-found");
  });

  it("prefers data fields when both data and context exist", async () => {
    const ctx = new Response(JSON.stringify({ error: "from-context", code: "A" }), { status: 502 });
    const payload = await readFunctionErrorPayload(
      { context: ctx },
      { error: "from-data", code: "B", detail: "d", aws_state: "stopped" },
    );
    expect(payload?.error).toBe("from-data");
    expect(payload?.code).toBe("B");
    expect(payload?.detail).toBe("d");
  });
});
