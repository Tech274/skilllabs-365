import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  effectiveReconcileDryRun,
  planAzure,
  reconcilePersistence,
  reconcileWritesEnabled,
  type ReconcileVm,
} from "./vm-reconcile.ts";

function withEnv(pairs: Record<string, string | null>, fn: () => void) {
  const prev = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(pairs)) {
    prev.set(k, Deno.env.get(k));
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("vm-reconcile defaults to dry-run and writes nothing, promotions included", () => {
  withEnv({ VM_RECONCILE_MODE: null, VM_RECONCILE_DRY_RUN: null }, () => {
    assertEquals(reconcileWritesEnabled(), false);
    assertEquals(effectiveReconcileDryRun({}), true);
  });
  withEnv({ VM_RECONCILE_MODE: null, VM_RECONCILE_DRY_RUN: "true" }, () => {
    assertEquals(reconcileWritesEnabled(), false);
    assertEquals(effectiveReconcileDryRun({}), true);
  });
  assertEquals(
    reconcilePersistence({ dryRun: true, drift: true, protected: false, promote: true }),
    "dry_run",
  );
  assertEquals(
    reconcilePersistence({ dryRun: true, drift: true, protected: false, promote: false }),
    "dry_run",
  );
});

Deno.test("vm-reconcile opt-in enables writes; body dry_run still forces a report", () => {
  withEnv({ VM_RECONCILE_MODE: "apply", VM_RECONCILE_DRY_RUN: null }, () => {
    assertEquals(reconcileWritesEnabled(), true);
    assertEquals(effectiveReconcileDryRun({}), false);
    assertEquals(effectiveReconcileDryRun({ bodyDryRun: true }), true);
  });
  withEnv({ VM_RECONCILE_MODE: null, VM_RECONCILE_DRY_RUN: "false" }, () => {
    assertEquals(reconcileWritesEnabled(), true);
    assertEquals(effectiveReconcileDryRun({}), false);
  });
  assertEquals(
    reconcilePersistence({ dryRun: false, drift: true, protected: false, promote: true }),
    "write",
  );
});

Deno.test("Azure stopped does not finalise a Hub stop as deallocated", () => {
  const fresh = new Date().toISOString();
  const vm: ReconcileVm = {
    id: "vm-1",
    status: "running",
    azure_vm_id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/lab-1",
    network_info: { stop_pending: { at: fresh, reason: "admin_stop", by: "admin" } },
  };
  const pending = planAzure(vm, { kind: "mapped", status: "stopped" }, Date.now());
  assertEquals(pending.code, "HUB_STOP_PENDING");
  assertEquals(pending.status, undefined);
  assertEquals(pending.finaliseHubStop, undefined);

  const done = planAzure(vm, { kind: "mapped", status: "deallocated" }, Date.now());
  assertEquals(done.status, "deallocated");
  assertEquals(done.finaliseHubStop?.reason, "admin_stop");

  const external: ReconcileVm = { ...vm, network_info: {} };
  const observed = planAzure(external, { kind: "mapped", status: "stopped" }, Date.now());
  assertEquals(observed.status, "stopped");
  assertEquals(observed.finaliseHubStop, undefined);
});

Deno.test("vm-reconcile dry-run does not write a protected or unchanged row", () => {
  assertEquals(
    reconcilePersistence({ dryRun: false, drift: true, protected: true, promote: true }),
    "protected",
  );
  assertEquals(
    reconcilePersistence({ dryRun: false, drift: false, protected: false }),
    "unchanged",
  );
});
