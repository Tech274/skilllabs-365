/**
 * Consume SkillTrack → SkillHub deep-link query params.
 * No SSO — query context only. Persist briefly so auth redirects don't drop them.
 */

export const HANDOFF_STORAGE_KEY = "skilltrack_handoff_v1";

export type SkillTrackHandoff = {
  handoff?: string;
  email?: string;
  phone?: string;
  sku?: string;
  cert?: string;
  lead?: string;
  invoice?: string;
  capturedAt: string;
};

const KEYS = ["handoff", "email", "phone", "sku", "cert", "lead", "invoice"] as const;

function trim(v: string | null | undefined): string | undefined {
  const t = (v || "").trim();
  return t || undefined;
}

/** Read handoff params from a URLSearchParams / location search string. */
export function parseHandoffSearch(search: string | URLSearchParams): Omit<SkillTrackHandoff, "capturedAt"> {
  const sp = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`) : search;
  const out: Omit<SkillTrackHandoff, "capturedAt"> = {};
  for (const k of KEYS) {
    const v = trim(sp.get(k));
    if (v) (out as any)[k] = v;
  }
  return out;
}

export function captureHandoffFromLocation(search = typeof window !== "undefined" ? window.location.search : ""): SkillTrackHandoff | null {
  const parsed = parseHandoffSearch(search);
  if (!parsed.handoff && !parsed.email && !parsed.sku && !parsed.cert) return null;
  const payload: SkillTrackHandoff = { ...parsed, capturedAt: new Date().toISOString() };
  try {
    sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
  return payload;
}

export function readStoredHandoff(): SkillTrackHandoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SkillTrackHandoff;
  } catch {
    return null;
  }
}

export function clearStoredHandoff() {
  try {
    sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Soft-log handoff (table optional — ignore if missing). */
export async function logHandoffEvent(
  supabase: { from: (t: string) => any },
  payload: SkillTrackHandoff & { user_id?: string | null },
) {
  try {
    await supabase.from("skilltrack_handoff_events").insert({
      handoff: payload.handoff ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      sku: payload.sku ?? null,
      cert: payload.cert ?? null,
      lead: payload.lead ?? null,
      invoice: payload.invoice ?? null,
      user_id: payload.user_id ?? null,
      captured_at: payload.capturedAt,
    });
  } catch {
    /* table may not exist yet — non-blocking */
  }
}

export const HUB_WHATSAPP_UPSELL =
  "https://wa.me/919999999999?text=" +
  encodeURIComponent("Hi SkillTrack — I need Hub lab access after payment.");
