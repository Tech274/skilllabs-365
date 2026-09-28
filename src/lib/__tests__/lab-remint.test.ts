import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import { adminStartVm, AlreadyStartingError, isResumableStatus, needsRemint, remintAndWaitRunning, remintIdempotencyScope, shouldEndOnCountdown } from "@/lib/lab-remint";

describe("lab-remint helpers", () => {
  it("needsRemint covers powered-off and starting", () => {
    expect(needsRemint("deallocated")).toBe(true);
    expect(needsRemint("stopped")).toBe(true);
    expect(needsRemint("starting")).toBe(true);
    expect(needsRemint("running")).toBe(false);
  });

  it("isResumableStatus only when Start should call start-vm", () => {
    expect(isResumableStatus("deallocated")).toBe(true);
    expect(isResumableStatus("stopped")).toBe(true);
    expect(isResumableStatus("starting")).toBe(false);
    expect(isResumableStatus("running")).toBe(false);
  });

  it("shouldEndOnCountdown never ends on a stale pre-remint expires_at (SCRUM-21)", () => {
    // Remint in flight or machine still powered off / waking: keep going.
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: true, vmStatus: "running" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "deallocated" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "starting" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: -60_000, reminting: false, vmStatus: "stopped" })).toBe(false);
  });

  it("shouldEndOnCountdown ends only on a trusted expiry of a running lab", () => {
    expect(shouldEndOnCountdown({ remainingMs: 0, reminting: false, vmStatus: "running" })).toBe(true);
    expect(shouldEndOnCountdown({ remainingMs: -1, reminting: false, vmStatus: "idle" })).toBe(true);
    expect(shouldEndOnCountdown({ remainingMs: 5_000, reminting: false, vmStatus: "running" })).toBe(false);
    expect(shouldEndOnCountdown({ remainingMs: Number.NaN, reminting: false, vmStatus: "running" })).toBe(false);
  });
});

describe("remint idempotency key", () => {
  beforeEach(() => {
    invoke.mockReset();
    sessionStorage.clear();
  });

  it("scopes a persistent remint separately from a start-vm remint", () => {
    expect(remintIdempotencyScope({ vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true }))
      .toBe("provision:lab-1:vm-1");
    expect(remintIdempotencyScope({ vmId: "vm-1", labTemplateId: "lab-1" })).toBe("start-vm:vm-1");
  });

  it("sends Idempotency-Key on provision-lab and a second click gets a different key", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    const opts = { vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true as const };
    await remintAndWaitRunning(opts);
    await remintAndWaitRunning(opts);
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].headers["Idempotency-Key"]).toEqual(expect.any(String));
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
    expect(starts[0][1].body).toEqual({ lab_template_id: "lab-1", vm_id: "vm-1" });
  });

  it("start, then leave, then start again sends a new provision-lab request", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    const opts = { vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true as const };
    await remintAndWaitRunning(opts);
    // Leave does not remint. The stored key must already be gone so the next
    // Start cannot replay the completed 200.
    expect(sessionStorage.getItem("idem:provision:lab-1:vm-1")).toBeNull();
    await remintAndWaitRunning(opts);
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
    expect(starts[1][1].body).toEqual({ lab_template_id: "lab-1", vm_id: "vm-1" });
  });

  it("refuses a second click while the first request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    invoke.mockImplementation(async (name: string) => {
      if (name === "provision-lab") await gate;
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    const opts = { vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true as const };
    const first = remintAndWaitRunning(opts);
    const second = remintAndWaitRunning(opts);
    await expect(second).rejects.toBeInstanceOf(AlreadyStartingError);
    const during = sessionStorage.getItem("idem:provision:lab-1:vm-1");
    expect(during).toBeTruthy();
    const inFlightKey = JSON.parse(during as string).key as string;
    expect(invoke.mock.calls.find((call) => call[0] === "provision-lab")?.[1].headers["Idempotency-Key"]).toBe(inFlightKey);
    release();
    await first;
    expect(sessionStorage.getItem("idem:provision:lab-1:vm-1")).toBeNull();
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(1);
  });

  it("keeps the key and reports already starting when the server returns 409", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 409,
          error: "A provisioning request with this idempotency key is already in progress.",
        },
      },
    });
    await expect(remintAndWaitRunning({
      vmId: "vm-1",
      labTemplateId: "lab-1",
      isPersistent: true,
    })).rejects.toThrow(/already starting/i);
    const sent = invoke.mock.calls[0][1].headers["Idempotency-Key"] as string;
    const raw = sessionStorage.getItem("idem:provision:lab-1:vm-1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).key).toBe(sent);
  });

  it("sends Idempotency-Key on cleanup start-vm", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    await remintAndWaitRunning({ vmId: "vm-1" });
    const start = invoke.mock.calls.find((call) => call[0] === "cleanup-idle-labs");
    expect(start?.[1].body).toEqual({ action: "start-vm", vm_id: "vm-1", reason: "learner_start" });
    expect(start?.[1].headers["Idempotency-Key"]).toEqual(expect.any(String));
  });

  it("drops the key after a failed start so the retry is not a replay", async () => {
    invoke.mockResolvedValueOnce({
      data: { error: "still stopping", code: "REMINT_START_FAILED", retryable: true },
      error: null,
    });
    await expect(remintAndWaitRunning({
      vmId: "vm-1",
      labTemplateId: "lab-1",
      isPersistent: true,
    })).rejects.toThrow();
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    await remintAndWaitRunning({ vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true });
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
  });

  it("drops the key when the 180s running wait times out so the next click is fresh", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "deallocated" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    await expect(remintAndWaitRunning({
      vmId: "vm-1",
      labTemplateId: "lab-1",
      isPersistent: true,
      timeoutMs: 30,
      pollMs: 5,
    })).rejects.toThrow(/timed out waiting for running/);
    expect(sessionStorage.getItem("idem:provision:lab-1:vm-1")).toBeNull();
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-1", status: "starting" }, error: null };
    });
    await remintAndWaitRunning({ vmId: "vm-1", labTemplateId: "lab-1", isPersistent: true });
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
  });
});

describe("admin /vms Start", () => {
  beforeEach(() => {
    invoke.mockReset();
    sessionStorage.clear();
  });

  it("gives a persistent admin Start a fresh key per click and drops it after success", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-9", status: "starting" }, error: null };
    });
    const opts = { vmId: "vm-9", labTemplateId: "lab-9", isPersistent: true as const };
    await adminStartVm(opts);
    expect(sessionStorage.getItem("idem:provision:lab-9:vm-9")).toBeNull();
    await adminStartVm(opts);
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].headers["Idempotency-Key"]).toEqual(expect.any(String));
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
    expect(starts[0][1].body).toEqual({ lab_template_id: "lab-9", vm_id: "vm-9" });
    expect(starts[1][1].body).toEqual({ lab_template_id: "lab-9", vm_id: "vm-9" });
  });

  it("gives a non-persistent admin Start a fresh key per click and drops it after success", async () => {
    invoke.mockResolvedValue({ data: { vm_id: "vm-9", status: "starting" }, error: null });
    await adminStartVm({ vmId: "vm-9" });
    expect(sessionStorage.getItem("idem:start-vm:vm-9")).toBeNull();
    await adminStartVm({ vmId: "vm-9" });
    const starts = invoke.mock.calls.filter((call) => call[0] === "cleanup-idle-labs");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].body).toEqual({ action: "start-vm", vm_id: "vm-9", reason: "admin_start" });
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
  });

  it("keeps the admin Start key when a second in-flight click is a 409", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 409,
          error: "A provisioning request with this idempotency key is already in progress.",
        },
      },
    });
    await expect(adminStartVm({ vmId: "vm-9" })).rejects.toThrow(/already starting/i);
    const sent = invoke.mock.calls[0][1].headers["Idempotency-Key"] as string;
    const raw = sessionStorage.getItem("idem:start-vm:vm-9");
    expect(JSON.parse(raw as string).key).toBe(sent);
  });

  it("drops the /vms key when the running wait times out so the next Start is fresh", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "deallocated" }, error: null };
      return { data: { vm_id: "vm-9", status: "starting" }, error: null };
    });
    await expect(adminStartVm({
      vmId: "vm-9",
      labTemplateId: "lab-9",
      isPersistent: true,
      timeoutMs: 30,
      pollMs: 5,
    })).rejects.toThrow(/timed out waiting for running/);
    expect(sessionStorage.getItem("idem:provision:lab-9:vm-9")).toBeNull();
    invoke.mockImplementation(async (name: string) => {
      if (name === "check-vm-status") return { data: { status: "running" }, error: null };
      return { data: { vm_id: "vm-9", status: "starting" }, error: null };
    });
    await adminStartVm({ vmId: "vm-9", labTemplateId: "lab-9", isPersistent: true });
    const starts = invoke.mock.calls.filter((call) => call[0] === "provision-lab");
    expect(starts).toHaveLength(2);
    expect(starts[0][1].headers["Idempotency-Key"]).not.toBe(starts[1][1].headers["Idempotency-Key"]);
  });
});
