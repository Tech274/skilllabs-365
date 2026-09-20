// Filtering + CSV helpers for the GCP impersonation audit log.
//
// Rows come from public.admin_audit_logs where action starts with
// "gcp.impersonation" — verify checks, live token tests, bulk verifications and
// binding configuration changes.

export interface ImpersonationAuditRow {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  entity_label: string | null;
  entity_id: string | null;
  outcome: string;
  message: string | null;
  changes: Record<string, unknown> | null;
}

export type ImpersonationRange = "all" | "24h" | "7d" | "30d" | "custom";

export interface ImpersonationAuditFilters {
  /** Substring match on the acting admin's email. */
  actor?: string;
  /** Substring match on the target lab service account. */
  target?: string;
  /** Exact audit action, or "all". */
  action?: string;
  range?: ImpersonationRange;
  from?: string | null;
  to?: string | null;
}

/** Every lab service account referenced by an audit row (single or bulk). */
export function targetsOf(row: ImpersonationAuditRow): string[] {
  const c = row.changes ?? {};
  const out: string[] = [];
  if (typeof c.lab_service_account === "string") out.push(c.lab_service_account);
  if (Array.isArray(c.targets)) {
    for (const t of c.targets as Array<Record<string, unknown>>) {
      if (t && typeof t.lab_service_account === "string") out.push(t.lab_service_account);
    }
  }
  return out;
}

function rangeStart(range: ImpersonationRange, now = Date.now()): number | null {
  if (range === "24h") return now - 24 * 3600_000;
  if (range === "7d") return now - 7 * 24 * 3600_000;
  if (range === "30d") return now - 30 * 24 * 3600_000;
  return null;
}

export function filterImpersonationAudit(
  rows: ImpersonationAuditRow[],
  f: ImpersonationAuditFilters,
): ImpersonationAuditRow[] {
  const actor = (f.actor ?? "").trim().toLowerCase();
  const target = (f.target ?? "").trim().toLowerCase();
  const action = f.action && f.action !== "all" ? f.action : null;
  const range = f.range ?? "all";
  const start = range === "custom" ? (f.from ? Date.parse(f.from) : null) : rangeStart(range);
  const end = range === "custom" && f.to ? Date.parse(f.to) : null;

  return rows.filter((r) => {
    if (actor && !(r.actor_email ?? "").toLowerCase().includes(actor)) return false;
    if (target && !targetsOf(r).some((t) => t.toLowerCase().includes(target))) return false;
    if (action && r.action !== action) return false;
    const at = Date.parse(r.created_at);
    if (start != null && Number.isFinite(start) && at < start) return false;
    if (end != null && Number.isFinite(end) && at > end) return false;
    return true;
  });
}

/** Parse "label, service-account, project-id" lines into bulk verifier targets. */
export function parseBulkTargets(text: string): { label: string | null; lab_service_account: string; project_id: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      // A bare service account on its own line is also accepted.
      const saIndex = parts.findIndex((p) => p.includes("@"));
      if (saIndex === -1) return null;
      return {
        label: saIndex > 0 ? parts[0] : null,
        lab_service_account: parts[saIndex],
        project_id: parts[saIndex + 1] || null,
      };
    })
    .filter(Boolean) as { label: string | null; lab_service_account: string; project_id: string | null }[];
}

const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toImpersonationAuditCsv(rows: ImpersonationAuditRow[]): string {
  const header = [
    "timestamp", "actor", "action", "outcome", "template", "target_service_accounts",
    "token_minted", "rate_limited", "message",
  ];
  const body = rows.map((r) => {
    const c = r.changes ?? {};
    return [
      r.created_at,
      r.actor_email ?? "",
      r.action,
      r.outcome,
      r.entity_label ?? r.entity_id ?? "",
      targetsOf(r).join(" "),
      c.token_minted === undefined ? "" : String(c.token_minted),
      c.rate_limited === undefined ? "" : String(c.rate_limited),
      r.message ?? "",
    ].map(escape).join(",");
  });
  return [header.map(escape).join(","), ...body].join("\n");
}
