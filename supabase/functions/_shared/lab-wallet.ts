/**
 * Lab wallet (edge): allocated − used = remaining.
 * Minutes come from real session usage only (template.duration prepaid pool —
 * including persistent labs). Soft-stop / Leave never deletes the VM.
 * Persistent also gates on end_date EOD IST (windowEnded).
 */

export type WalletSessionRow = {
  started_at?: string | null;
  ended_at?: string | null;
};

export type WalletSnapshot = {
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  exhausted: boolean;
  windowEnded: boolean;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** End of the persistent window: 23:59:59.999 IST on end_date. */
export function endOfDayIst(endDateIso: string): number {
  const d = new Date(endDateIso);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(23, 59, 59, 999);
  return ist.getTime() - IST_OFFSET_MS;
}

/** Sum billable minutes across sessions (open sessions count through `now`). */
export function usedMinutesFromSessions(
  sessions: WalletSessionRow[],
  nowMs: number = Date.now(),
): number {
  let total = 0;
  for (const s of sessions) {
    if (!s.started_at) continue;
    const start = new Date(s.started_at).getTime();
    if (Number.isNaN(start)) continue;
    const end = s.ended_at ? new Date(s.ended_at).getTime() : nowMs;
    if (Number.isNaN(end) || end <= start) continue;
    total += (end - start) / 60000;
  }
  return Math.round(total);
}

export function buildWalletSnapshot(args: {
  duration?: number | null;
  endDate?: string | null;
  isPersistent?: boolean | null;
  sessions: WalletSessionRow[];
  nowMs?: number;
}): WalletSnapshot {
  const nowMs = args.nowMs ?? Date.now();
  const allocatedMinutes = Math.max(Math.round(args.duration ?? 0), 0);
  const usedMinutes = usedMinutesFromSessions(args.sessions, nowMs);
  const remainingMinutes = Math.max(allocatedMinutes - usedMinutes, 0);
  const endMs = args.endDate ? endOfDayIst(args.endDate) : Number.NaN;
  const windowEnded = Boolean(args.isPersistent) && !Number.isNaN(endMs) && nowMs > endMs;
  return {
    allocatedMinutes,
    usedMinutes,
    remainingMinutes,
    exhausted: allocatedMinutes > 0 && remainingMinutes <= 0,
    windowEnded,
  };
}

export const LAB_MINUTES_EXHAUSTED = "LAB_MINUTES_EXHAUSTED";
export const LAB_WINDOW_ENDED = "LAB_WINDOW_ENDED";

export function walletBlockMessage(snapshot: WalletSnapshot): { code: string; error: string } | null {
  if (snapshot.windowEnded) {
    return {
      code: LAB_WINDOW_ENDED,
      error:
        "This lab’s date window has ended. Start is blocked. Your lab machine is held (not deleted) — contact Ops if you need an extension.",
    };
  }
  if (snapshot.exhausted) {
    return {
      code: LAB_MINUTES_EXHAUSTED,
      error:
        `Lab minutes used up (${snapshot.allocatedMinutes} allocated, ${snapshot.usedMinutes} used, 0 remaining). Start is blocked until more minutes are granted. Your lab machine is held (not deleted).`,
    };
  }
  return null;
}
