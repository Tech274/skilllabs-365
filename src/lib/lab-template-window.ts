/**
 * Persistent lab template windows (Asia/Kolkata).
 *
 * Persistent templates combine:
 *   - prepaid Total minutes (lab_templates.duration) — session wallet pool
 *   - Start date → End date access WINDOW only (not a 24/7 always-on VM)
 *
 * Learners may start many sessions of any length until minutes exhaust INSIDE
 * the window. End date means end-of-day IST — soft-expiry deallocates + notifies;
 * it never silently terminates, and a disconnect is not a deallocate.
 * Non-persistent templates keep Total minutes only and carry no date window.
 */

export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** ISO instant → `YYYY-MM-DD` as seen in IST. */
export function toIstDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts;
}

/** `YYYY-MM-DD` (IST) → ISO instant at 00:00 IST. */
export function istDateToStartIso(date: string): string | null {
  if (!date.trim()) return null;
  const d = new Date(`${date}T00:00:00.000${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `YYYY-MM-DD` (IST) → ISO instant at end-of-day IST (23:59:59.999). */
export function istDateToEndIso(date: string): string | null {
  if (!date.trim()) return null;
  const d = new Date(`${date}T23:59:59.999${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human date for admin copy, e.g. "12 Oct 2026 (IST)". */
export function formatIstDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)} (IST)`;
}

/** Start date + duration in days → inclusive end date (`YYYY-MM-DD`, IST). */
export function endDateFromDuration(startDate: string, durationDays: number): string {
  if (!startDate.trim() || !Number.isFinite(durationDays) || durationDays < 1) return "";
  const base = new Date(`${startDate}T00:00:00.000${IST_OFFSET}`);
  if (Number.isNaN(base.getTime())) return "";
  base.setUTCDate(base.getUTCDate() + Math.floor(durationDays) - 1);
  return toIstDateInput(base.toISOString());
}

export type TemplateWindowInput = {
  isPersistent: boolean;
  startDate: string;
  endDate: string;
};

/** Prepaid Total minutes must be > 0 for every lab (persistent included). */
export function validatePrepaidMinutes(duration: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0) {
    return "Total minutes must be greater than 0 (prepaid session pool).";
  }
  return null;
}

/** Validate the template form window. Returns a learner-free admin error string. */
export function validateTemplateWindow(input: TemplateWindowInput): string | null {
  if (!input.isPersistent) return null;
  if (!input.startDate.trim()) return "Persistent labs need a start date (Asia/Kolkata).";
  if (!input.endDate.trim()) return "Persistent labs need an end date (Asia/Kolkata).";
  const start = istDateToStartIso(input.startDate);
  const end = istDateToEndIso(input.endDate);
  if (!start || !end) return "Enter valid start and end dates.";
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    return "End date must be after the start date (Asia/Kolkata).";
  }
  return null;
}

/**
 * A grant may never outlive the lab window it unlocks.
 * `templateEndIso` is the furthest published template end; null means no cap.
 */
export function validateGrantWindow(
  grantEndsAtIso: string | null,
  templateEndIso: string | null,
): string | null {
  if (!templateEndIso) return null;
  const cap = new Date(templateEndIso).getTime();
  if (Number.isNaN(cap)) return null;
  if (!grantEndsAtIso) {
    return `This grant has no end date, but lab access ends ${formatIstDate(templateEndIso)}. Set a grant end on or before that date.`;
  }
  const ends = new Date(grantEndsAtIso).getTime();
  if (Number.isNaN(ends)) return "Enter a valid grant end date and time.";
  if (ends > cap) {
    return `Grant end is after the lab template end (${formatIstDate(templateEndIso)}). Shorten the grant window so it ends on or before the template end date.`;
  }
  return null;
}
