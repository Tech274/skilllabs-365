import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  effectiveReconcileDryRun,
  reconcilePersistence,
  reconcileWritesEnabled,
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
