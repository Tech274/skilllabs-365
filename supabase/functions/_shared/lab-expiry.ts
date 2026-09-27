/**
 * Soft-expiry decisions for the cleanup-idle-labs cron (SCRUM-28).
 *
 * One pure function decides whether a lab VM must be soft-stopped because its
 * access is over. Everything here is side-effect free so it can be unit-tested
 * and reused by the admin `expiry-preview` dry run.
 *
 * Policy (unchanged product law): expiry DEALLOCATES and notifies. It never
 * terminates or deletes a VM. Hard delete stays admin-only.
 *
 * Triggers, in priority order:
 *   1. `virtual_machines.expires_at` is in the past            → lab_window_expired
 *   2. persistent template end_date (EOD IST) has passed        → lab_window_expired
 *   3. learner's prepaid minutes for the template are used up   → lab_minutes_exhausted
 *
 * The end-date rule uses the SAME wallet snapshot as the learner Start gate
 * (`buildWalletSnapshot`), so the sweep and the gate always agree: a VM the
 * sweep deallocates cannot be restarted by the learner, and vice versa.
 */

import { buildWalletSnapshot, type WalletSessionRow } from "./lab-wallet.ts";

/**
 * Hub statuses where compute may still be billing, so an expired lab must be
 * soft-stopped. `idle` is running compute with no activity; `stopped` is an
 * OS-level shutdown — on Azure that is still allocated (and billed) until it
 * is deallocated.
 */
export const SOFT_EXPIRY_STATUSES = [
  "running",
  "provisioning",
  "starting",
  "idle",
  "stopped",
] as const;

/** Live statuses swept as orphans when no session is active. */
export const ORPHAN_SWEEP_STATUSES = ["running", "idle"] as const;

export type SoftExpiryReason = "lab_window_expired" | "lab_minutes_exhausted";
export type SoftExpiryTrigger = "expires_at" | "template_end_date" | "minutes_exhausted";

export type SoftExpiryTemplate = {
  name?: string | null;
  duration?: number | null;
  is_persistent?: boolean | null;
  end_date?: string | null;
};

export type SoftExpiryInput = {
  status: string | null | undefined;
  expiresAt?: string | null;
  template?: SoftExpiryTemplate | null;
  /** This learner's sessions on the template (wallet usage). */
  sessions?: WalletSessionRow[];
  nowMs: number;
};

export type SoftExpiryDecision = {
  reason: SoftExpiryReason;
  trigger: SoftExpiryTrigger;
  allocatedMinutes?: number;
  usedMinutes?: number;
};

export function isSoftExpiryStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (SOFT_EXPIRY_STATUSES as readonly string[]).includes(String(status).toLowerCase());
}

/** Returns why this VM must be soft-stopped now, or null to leave it alone. */
export function decideSoftExpiry(input: SoftExpiryInput): SoftExpiryDecision | null {
  if (!isSoftExpiryStatus(input.status)) return null;

  // Persistent labs are governed by template end_date + wallet only (provision
  // never sets expires_at for them). A stale expires_at on a persistent row must
  // not undo a learner/admin Start on the next cron tick (review follow-up).
  // Unknown persistence (no template id, template row missing, or the lookup
  // failed) is treated like persistent — the cautious default, same as the
  // SCRUM-106 Cancel policy. Only a template that is KNOWN non-persistent lets
  // expires_at stop the VM. Such rows are reported via `expiresAtSkippedReason`.
  if (input.expiresAt && input.template?.is_persistent === false) {
    const expires = Date.parse(input.expiresAt);
    if (!Number.isNaN(expires) && expires < input.nowMs) {
      return { reason: "lab_window_expired", trigger: "expires_at" };
    }
  }

  const tpl = input.template;
  if (!tpl) return null;

  const snap = buildWalletSnapshot({
    duration: tpl.duration,
    endDate: tpl.end_date,
    isPersistent: tpl.is_persistent,
    sessions: input.sessions ?? [],
    nowMs: input.nowMs,
  });
  if (snap.windowEnded) {
    return {
      reason: "lab_window_expired",
      trigger: "template_end_date",
      allocatedMinutes: snap.allocatedMinutes,
      usedMinutes: snap.usedMinutes,
    };
  }
  if (snap.exhausted) {
    return {
      reason: "lab_minutes_exhausted",
      trigger: "minutes_exhausted",
      allocatedMinutes: snap.allocatedMinutes,
      usedMinutes: snap.usedMinutes,
    };
  }
  return null;
}

/**
 * Why a VM whose `expires_at` has passed was NOT soft-expired on that trigger:
 * `persistent` (window + wallet govern it) or `template_unknown` (cautious
 * default). Null when expires_at is unset/in the future or the template is
 * known non-persistent. Used to make the skip visible in the run response.
 */
export function expiresAtSkippedReason(input: {
  status: string | null | undefined;
  expiresAt?: string | null;
  template?: SoftExpiryTemplate | null;
  nowMs: number;
}): "persistent" | "template_unknown" | null {
  if (!isSoftExpiryStatus(input.status) || !input.expiresAt) return null;
  const expires = Date.parse(input.expiresAt);
  if (Number.isNaN(expires) || expires >= input.nowMs) return null;
  const p = input.template?.is_persistent;
  if (p === true) return "persistent";
  if (p === false) return null;
  return "template_unknown";
}

/** Learner + admin notification copy for a soft-expiry. */
export function softExpiryNotice(
  decision: SoftExpiryDecision,
  label: string,
  templateName?: string | null,
): { type: string; title: string; message: string } {
  const lab = templateName ? `Lab ${templateName}` : "Your lab";
  if (decision.trigger === "expires_at") {
    return {
      type: "lab_expired",
      title: "Lab window expired — VM deallocated",
      message:
        `Lab VM ${label} reached expires_at and was soft-stopped (deallocated). Resources are held, not deleted. Contact an admin to resume or purge.`,
    };
  }
  if (decision.trigger === "template_end_date") {
    return {
      type: "lab_expired",
      title: "Lab window ended — VM deallocated",
      message:
        `${lab} reached its end date (EOD IST). VM ${label} was deallocated. Resources are held, not deleted.`,
    };
  }
  return {
    type: "lab_minutes_exhausted",
    title: "Lab minutes used up — VM deallocated",
    message:
      `${lab} used all ${decision.allocatedMinutes ?? 0} allocated minutes. VM ${label} was deallocated. Resources are held, not deleted.`,
  };
}

/**
 * Sweep mode (review follow-up). Read from the `SOFT_EXPIRY_MODE` secret.
 *
 * SCOPE: this ONLY gates the soft-expiry sweep (expires_at / template end date /
 * minutes used up). The idle pass, the orphan pass (incl. Cancel pending-stop
 * retries) and the stuck-provisioning pass run in EVERY mode, including `off`.
 * That is a product decision — do not wire them to this switch.
 *
 *   - unset / empty → "legacy": enforce only what the pre-SCRUM-28 sweep already
 *     enforced (expires_at on running/provisioning/starting; end date / minutes on
 *     running/provisioning/starting/idle). Newly covered cases (OS-stopped VMs,
 *     idle past expires_at) are reported as dry-run until Ops opts in. Kept for
 *     backward compatibility with deployments that never set the secret.
 *   - "enforce" → full SCRUM-28 scope.
 *   - "dry-run" → report only, never stop anything.
 *   - "off"     → skip the soft-expiry sweep entirely.
 *   - anything else (typo such as `dry_run`, `disabled`, `false`) → fail SAFE to
 *     "dry-run", log a warning and report it in the run response
 *     (`soft_expiry.mode = "dry-run"`, `mode_configured`, `mode_warning`).
 */
export type SoftExpiryMode = "legacy" | "enforce" | "dry-run" | "off";

export interface SoftExpiryModeConfig {
  mode: SoftExpiryMode;
  /** Raw secret value (trimmed) or null when unset/empty. */
  configured: string | null;
  /** Set when the configured value was not recognised. */
  warning: string | null;
}

export function resolveSoftExpiryMode(raw: string | null | undefined): SoftExpiryModeConfig {
  const configured = String(raw ?? "").trim();
  if (!configured) return { mode: "legacy", configured: null, warning: null };
  const v = configured.toLowerCase();
  if (v === "legacy" || v === "enforce" || v === "dry-run" || v === "off") {
    return { mode: v, configured, warning: null };
  }
  return {
    mode: "dry-run",
    configured,
    warning:
      `Unknown SOFT_EXPIRY_MODE "${configured}" — failing safe to dry-run (no soft-expiry stops). ` +
      `Valid values: legacy, enforce, dry-run, off.`,
  };
}

export function parseSoftExpiryMode(raw: string | null | undefined): SoftExpiryMode {
  return resolveSoftExpiryMode(raw).mode;
}

const LEGACY_EXPIRES_AT_STATUSES = ["running", "provisioning", "starting"];
const LEGACY_WALLET_STATUSES = ["running", "provisioning", "starting", "idle"];

/** May the sweep actually deallocate this due VM under `mode`? */
export function softExpiryEnforced(
  mode: SoftExpiryMode,
  status: string | null | undefined,
  decision: SoftExpiryDecision,
): boolean {
  if (mode === "enforce") return true;
  if (mode !== "legacy") return false;
  const st = String(status ?? "").toLowerCase();
  return decision.trigger === "expires_at"
    ? LEGACY_EXPIRES_AT_STATUSES.includes(st)
    : LEGACY_WALLET_STATUSES.includes(st);
}

/**
 * Held VMs (smoke VM, anything Ops is holding) that NO automatic cleanup pass
 * may stop, deallocate or delete. Built-in holds plus the comma-separated
 * `CLEANUP_HELD_VM_IDS` secret. Matching is case-insensitive. An entry matches:
 *
 *   1. the full Hub row id (`virtual_machines.id`, a UUID)
 *   2. a Hub row id PREFIX of 8+ hex characters — the short id the Hub shows on
 *      VM detail and in cleanup/watchdog logs (e.g. `bba27e8f`). A trailing
 *      `…` copied from the UI is ignored. Prefix matching applies to the Hub id
 *      only, never to cloud names, so `lab-` can never hold a whole fleet.
 *   3. the cloud instance id as stored in `azure_vm_id` (AWS `i-…`, or the full
 *      Azure ARM resource id)
 *   4. the VM name: the last segment of an Azure ARM id (e.g. `lab-3f2a1b9c-mf3k2`),
 *      i.e. the "instance" name the /vms page shows. AWS Name tags are not stored
 *      on the Hub row, so for AWS use the instance id (`i-…`) or the Hub id.
 *
 * Guac gateway hosts are not `virtual_machines` rows, so these passes never
 * see them.
 */
export const BUILTIN_HELD_VM_IDS: readonly string[] = [
  // Smoke VM held by Ops — release only on explicit owner GO. Referred to as
  // "smoke VM bba27e8f" in SCRUM-11/33/37/39/43. The 8-hex format is the Hub
  // short id (vm.id.slice(0, 8)); it cannot be an AWS instance id (i- + 17 hex)
  // or a Hub-generated cloud name (lab-<template8>-<ts>). Put the full Hub UUID
  // AND the cloud instance id in CLEANUP_HELD_VM_IDS so the hold does not rely
  // on this prefix alone.
  "bba27e8f",
];

const HUB_ID_PREFIX = /^[0-9a-f-]{8,}$/;

function normaliseHeldEntry(raw: string): string {
  return raw.trim().replace(/(\u2026|\.\.\.)$/u, "").trim().toLowerCase();
}

export interface HeldVmList {
  entries: string[];
  /** Entries that can never match anything (reported in the run response). */
  warnings: string[];
}

export function parseHeldVmConfig(raw: string | null | undefined): HeldVmList {
  const extra = String(raw ?? "")
    .split(",")
    .map(normaliseHeldEntry)
    .filter(Boolean);
  const entries = [...new Set([...BUILTIN_HELD_VM_IDS.map(normaliseHeldEntry), ...extra])];
  const warnings: string[] = [];
  for (const e of extra) {
    // Hub short ids are only honoured from 8 characters; a shorter hex entry
    // would silently never match a Hub id (Riley, #54).
    if (/^[0-9a-f-]{1,7}$/.test(e)) {
      warnings.push(
        `CLEANUP_HELD_VM_IDS entry "${e}" is shorter than 8 characters: it is not used as a Hub id prefix and only matches an exact cloud VM name`,
      );
    }
  }
  return { entries, warnings };
}

export function parseHeldVmList(raw: string | null | undefined): string[] {
  return parseHeldVmConfig(raw).entries;
}

function vmNameOf(cloudId: string): string {
  if (!cloudId.includes("/")) return cloudId;
  const parts = cloudId.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function isHeldVm(
  vm: { id?: string | null; azure_vm_id?: string | null },
  held: readonly string[],
): boolean {
  const id = String(vm.id ?? "").trim().toLowerCase();
  const cloud = String(vm.azure_vm_id ?? "").trim().toLowerCase();
  const cloudName = vmNameOf(cloud);
  for (const raw of held) {
    const entry = normaliseHeldEntry(raw);
    if (!entry) continue;
    if (id && id === entry) return true;
    if (id && HUB_ID_PREFIX.test(entry) && id.startsWith(entry)) return true;
    if (cloud && (cloud === entry || (cloudName && cloudName === entry))) return true;
  }
  return false;
}

/**
 * Parse a comma-separated id list with the SAME matching rules as
 * `CLEANUP_HELD_VM_IDS` (full Hub UUID, 8+ hex Hub prefix, cloud id, Azure VM
 * name). Does not add the built-in smoke id — that lives on the held list.
 */
export function parseVmIdList(raw: string | null | undefined, label = "VM id list"): HeldVmList {
  const extra = String(raw ?? "")
    .split(",")
    .map(normaliseHeldEntry)
    .filter(Boolean);
  const entries = [...new Set(extra)];
  const warnings: string[] = [];
  for (const e of extra) {
    if (/^[0-9a-f-]{1,7}$/.test(e)) {
      warnings.push(
        `${label} entry "${e}" is shorter than 8 characters: it is not used as a Hub id prefix and only matches an exact cloud VM name`,
      );
    }
  }
  return { entries, warnings };
}

export interface VmGuardLists {
  protectedEntries: readonly string[];
  /** Held entries, including the built-in smoke prefix `bba27e8f`. */
  heldEntries: readonly string[];
}

export interface VmGuardListOptions {
  /** Pass `null` for an empty list. Omit to read `VM_PROTECTED_IDS`. */
  protectedRaw?: string | null;
  /** Pass `null` for an empty extra list (built-in smoke id still applies). Omit to read `CLEANUP_HELD_VM_IDS`. */
  heldRaw?: string | null;
}

/**
 * Union of `VM_PROTECTED_IDS` and `CLEANUP_HELD_VM_IDS` (plus built-in
 * `bba27e8f`). A VM matched by either list is guarded. Both lists use prefix,
 * cloud-id and Azure-name matching.
 */
export function loadVmGuardLists(opts?: VmGuardListOptions): VmGuardLists & { warnings: string[] } {
  const held = parseHeldVmConfig(
    opts && "heldRaw" in opts ? opts.heldRaw : Deno.env.get("CLEANUP_HELD_VM_IDS"),
  );
  const prot = parseVmIdList(
    opts && "protectedRaw" in opts ? opts.protectedRaw : Deno.env.get("VM_PROTECTED_IDS"),
    "VM_PROTECTED_IDS",
  );
  return {
    protectedEntries: prot.entries,
    heldEntries: held.entries,
    warnings: [...held.warnings, ...prot.warnings],
  };
}

export function isVmGuarded(
  vm: { id?: string | null; azure_vm_id?: string | null },
  lists?: VmGuardLists,
): boolean {
  const resolved = lists ?? loadVmGuardLists();
  return isHeldVm(vm, resolved.heldEntries) || isHeldVm(vm, resolved.protectedEntries);
}
