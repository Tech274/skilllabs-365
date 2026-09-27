/**
 * Lab wallet: allocated − used = remaining.
 *
 * Minutes are consumed by SESSION USAGE only (time actually spent in a lab),
 * never by merely being assigned a grant. A grant unlocks the lab; the wallet
 * tracks the minutes.
 *
 * Persistent labs use the same prepaid duration pool PLUS a start/end date
 * access window (Asia/Kolkata) — not unlimited minutes and not a 24/7 always-on VM.
 * Soft-expiry fires at end_date EOD IST, or when remaining minutes hit zero —
 * always deallocate + notify, never a silent terminate.
 */

import { formatIstDate } from "@/lib/lab-template-window";

export type WalletSession = {
  lab_template_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
};

export type WalletTemplate = {
  id: string;
  duration?: number | null;
  is_persistent?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type LabWallet = {
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  percentUsed: number;
  exhausted: boolean;
  isPersistent: boolean;
  startLabel: string | null;
  endLabel: string | null;
  /** True once the persistent window's end date has passed (EOD IST). */
  windowEnded: boolean;
};

/** Minutes actually spent in sessions for one lab template (open sessions count so far). */
export function usedMinutesForTemplate(
  sessions: WalletSession[],
  templateId: string,
  now: number = Date.now(),
): number {
  const total = sessions.reduce((acc, s) => {
    if (s.lab_template_id !== templateId || !s.started_at) return acc;
    const start = new Date(s.started_at).getTime();
    if (Number.isNaN(start)) return acc;
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    if (Number.isNaN(end) || end <= start) return acc;
    return acc + (end - start) / 60000;
  }, 0);
  return Math.round(total);
}

/** End of the persistent window: 23:59:59.999 IST on end_date. */
export function endOfDayIst(endDateIso: string): number {
  const d = new Date(endDateIso);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  // Shift into IST, snap to the end of that calendar day, shift back to UTC.
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  ist.setUTCHours(23, 59, 59, 999);
  return ist.getTime() - 5.5 * 60 * 60 * 1000;
}

export function buildLabWallet(
  template: WalletTemplate,
  sessions: WalletSession[],
  now: number = Date.now(),
): LabWallet {
  const allocatedMinutes = Math.max(Math.round(template.duration ?? 0), 0);
  const usedMinutes = usedMinutesForTemplate(sessions, template.id, now);
  const remainingMinutes = Math.max(allocatedMinutes - usedMinutes, 0);
  const isPersistent = Boolean(template.is_persistent);
  const endMs = template.end_date ? endOfDayIst(template.end_date) : Number.NaN;

  return {
    allocatedMinutes,
    usedMinutes,
    remainingMinutes,
    percentUsed: allocatedMinutes > 0 ? Math.min((usedMinutes / allocatedMinutes) * 100, 100) : 0,
    exhausted: allocatedMinutes > 0 && remainingMinutes <= 0,
    isPersistent,
    startLabel: isPersistent && template.start_date ? formatIstDate(template.start_date) : null,
    endLabel: isPersistent && template.end_date ? formatIstDate(template.end_date) : null,
    windowEnded: isPersistent && !Number.isNaN(endMs) && now > endMs,
  };
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Start/Launch is blocked when minutes are exhausted or the persistent window ended. */
export function isStartBlocked(wallet: LabWallet): boolean {
  return wallet.exhausted || wallet.windowEnded;
}

/** Human equation e.g. "1200 − 40 = 1160". */
export function walletEquation(wallet: LabWallet): string {
  return `${wallet.allocatedMinutes} − ${wallet.usedMinutes} = ${wallet.remainingMinutes}`;
}

export function startBlockedMessage(wallet: LabWallet): string {
  if (wallet.windowEnded) {
    return "This lab’s date window has ended. Start is blocked. Your machine is held (not deleted) — contact Ops for an extension.";
  }
  if (wallet.exhausted) {
    return `Lab minutes used up (${walletEquation(wallet)}). Start is blocked until more minutes are granted. Your machine is held (not deleted).`;
  }
  return "";
}

/**
 * Admin Start is an override. The client wallet pre-check must not block it.
 * Learners (adminOverride false) still get the pre-check; the server enforces too.
 */
export function shouldRunClientWalletPrecheck(adminOverride: boolean): boolean {
  return !adminOverride;
}

export type VmWalletBlock = { code: "LAB_MINUTES_EXHAUSTED" | "LAB_WINDOW_ENDED"; message: string };

/**
 * Wallet gate for a specific VM, computed against the VM owner's usage
 * (Admin Start / barge-in sees the learner's minutes). Null when remint is allowed.
 * Date window is checked before minutes. Copy matches startBlockedMessage.
 */
export async function fetchVmWalletBlock(vmId: string): Promise<VmWalletBlock | null> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: vm } = await supabase
    .from("virtual_machines")
    .select("user_id, lab_template_id, lab_templates(id, duration, is_persistent, start_date, end_date)")
    .eq("id", vmId)
    .maybeSingle();
  if (!vm?.lab_template_id) return null;
  const tpl = (Array.isArray(vm.lab_templates) ? vm.lab_templates[0] : vm.lab_templates) as WalletTemplate | null;
  if (!tpl) return null;
  const { data: sessions } = await supabase
    .from("sessions")
    .select("lab_template_id, started_at, ended_at")
    .eq("user_id", vm.user_id)
    .eq("lab_template_id", vm.lab_template_id)
    .limit(500);
  const wallet = buildLabWallet({ ...tpl, id: vm.lab_template_id }, (sessions ?? []) as WalletSession[]);
  if (wallet.windowEnded) return { code: "LAB_WINDOW_ENDED", message: startBlockedMessage(wallet) };
  if (wallet.exhausted) return { code: "LAB_MINUTES_EXHAUSTED", message: startBlockedMessage(wallet) };
  return null;
}
