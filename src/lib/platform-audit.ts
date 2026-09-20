/**
 * Filtering + CSV helpers for the unified platform audit view.
 *
 * `admin_audit_logs` is the single sink every governed action writes to
 * (access requests, template policy changes, cloud identity updates, readiness
 * blocks, grants/revokes, budget blocks). Keeping the filter and export logic
 * here makes it testable without mounting the page.
 */

export type AuditSource = "governance" | "provisioning" | "reconcile";

export const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  governance: "Governance",
  provisioning: "Provisioning",
  reconcile: "VM lifecycle",
};

export interface PlatformAuditRow {
  id: string;
  /** Which timeline the row came from — governance, provisioning or lifecycle. */
  source?: AuditSource;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  outcome: string;
  message: string | null;
  correlation_id: string | null;
  changes: Record<string, unknown> | null;
}

/** Provider is not a column — it lives inside the per-action `changes` payload. */
export function providerOf(row: PlatformAuditRow): string | null {
  const c = row.changes ?? {};
  const raw = (c.provider ?? c.cloud ?? c.provider_key) as unknown;
  return typeof raw === "string" && raw.trim() ? raw.toLowerCase() : null;
}

export function actorOf(row: PlatformAuditRow): string {
  return row.actor_email ?? row.actor_id ?? row.actor_type ?? "system";
}

export function sourceOf(row: PlatformAuditRow): AuditSource {
  return row.source ?? "governance";
}

/** `provisioning_events` row → unified audit row. */
export function provisioningEventToAuditRow(e: {
  id: string; created_at: string; user_id?: string | null; source: string; step: string;
  status: string; message?: string | null; correlation_id?: string | null;
  detail?: Record<string, unknown> | null; vm_id?: string | null; lab_template_id?: string | null;
}): PlatformAuditRow {
  const detail = (e.detail ?? {}) as Record<string, unknown>;
  return {
    id: `prov:${e.id}`,
    source: "provisioning",
    created_at: e.created_at,
    actor_id: e.user_id ?? null,
    actor_email: typeof detail.owner === "string" ? detail.owner : null,
    actor_type: e.user_id ? "user" : "system",
    action: `provisioning.${e.source}.${e.step}`,
    entity_type: "vm_lab",
    entity_id: e.vm_id ?? e.lab_template_id ?? null,
    entity_label: typeof detail.lab === "string" ? detail.lab : (typeof detail.lab_name === "string" ? detail.lab_name : null),
    outcome: e.status === "success" ? "success" : e.status === "failed" ? "failed" : e.status === "skipped" ? "blocked" : "success",
    message: e.message ?? null,
    correlation_id: e.correlation_id ?? null,
    changes: detail,
  };
}

/** `reconcile_audit_trail` row → unified audit row. */
export function reconcileTrailToAuditRow(r: {
  id: string; created_at: string; provider: string; step: string; outcome: string;
  attempt: number; max_attempts: number; from_state?: string | null; to_state?: string | null;
  error_message?: string | null; error_cause?: string | null; entity_label?: string | null;
  vm_id?: string | null; lab_template_id?: string | null; correlation_id?: string | null;
  region?: string | null; detail?: Record<string, unknown> | null;
}): PlatformAuditRow {
  return {
    id: `rec:${r.id}`,
    source: "reconcile",
    created_at: r.created_at,
    actor_id: null,
    actor_email: null,
    actor_type: "watchdog",
    action: `reconcile.${r.step}`,
    entity_type: "virtual_machine",
    entity_id: r.vm_id ?? r.lab_template_id ?? null,
    entity_label: r.entity_label ?? null,
    outcome: r.outcome === "success" ? "success" : r.outcome === "skipped" ? "blocked" : "failed",
    message: r.error_message ?? `${r.from_state ?? "?"} → ${r.to_state ?? "?"} (attempt ${r.attempt}/${r.max_attempts})`,
    correlation_id: r.correlation_id ?? null,
    changes: {
      provider: r.provider,
      region: r.region ?? null,
      attempt: r.attempt,
      max_attempts: r.max_attempts,
      from_state: r.from_state ?? null,
      to_state: r.to_state ?? null,
      error_cause: r.error_cause ?? null,
      ...(r.detail ?? {}),
    },
  };
}

/** Merge every source into one chronological timeline (newest first). */
export function mergeAuditTimelines(...groups: PlatformAuditRow[][]): PlatformAuditRow[] {
  return groups.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export interface PlatformAuditFilters {
  source?: string;
  search?: string;
  action?: string;
  actor?: string;
  entityType?: string;
  provider?: string;
  outcome?: string;
  from?: Date | null;
  to?: Date | null;
}

export function filterPlatformAuditRows(rows: PlatformAuditRow[], f: PlatformAuditFilters): PlatformAuditRow[] {
  const q = (f.search ?? "").trim().toLowerCase();
  const any = (v?: string) => !v || v === "all";
  return rows.filter((r) => {
    if (!any(f.source) && sourceOf(r) !== f.source) return false;
    if (!any(f.action) && r.action !== f.action) return false;
    if (!any(f.actor) && actorOf(r) !== f.actor) return false;
    if (!any(f.entityType) && r.entity_type !== f.entityType) return false;
    if (!any(f.outcome) && r.outcome !== f.outcome) return false;
    if (!any(f.provider) && providerOf(r) !== f.provider) return false;
    const at = new Date(r.created_at).getTime();
    if (f.from && at < f.from.getTime()) return false;
    if (f.to && at > f.to.getTime()) return false;
    if (!q) return true;
    return [r.action, r.entity_type, r.entity_label, r.entity_id, r.message, actorOf(r), providerOf(r), r.correlation_id]
      .some((v) => (v ?? "").toString().toLowerCase().includes(q));
  });
}

export const PLATFORM_AUDIT_COLUMNS = [
  { key: "source", label: "Source", value: (r: PlatformAuditRow) => AUDIT_SOURCE_LABEL[sourceOf(r)] },
  { key: "created_at", label: "Timestamp", value: (r: PlatformAuditRow) => r.created_at },
  { key: "action", label: "Action", value: (r: PlatformAuditRow) => r.action },
  { key: "outcome", label: "Outcome", value: (r: PlatformAuditRow) => r.outcome },
  { key: "entity_type", label: "Entity type", value: (r: PlatformAuditRow) => r.entity_type },
  { key: "entity_label", label: "Entity", value: (r: PlatformAuditRow) => r.entity_label ?? "" },
  { key: "entity_id", label: "Entity ID", value: (r: PlatformAuditRow) => r.entity_id ?? "" },
  { key: "provider", label: "Cloud", value: (r: PlatformAuditRow) => providerOf(r) ?? "" },
  { key: "actor_email", label: "Actor", value: (r: PlatformAuditRow) => actorOf(r) },
  { key: "actor_type", label: "Actor type", value: (r: PlatformAuditRow) => r.actor_type },
  { key: "message", label: "Message", value: (r: PlatformAuditRow) => r.message ?? "" },
  { key: "correlation_id", label: "Correlation ID", value: (r: PlatformAuditRow) => r.correlation_id ?? "" },
  { key: "changes", label: "Changes (JSON)", value: (r: PlatformAuditRow) => JSON.stringify(r.changes ?? {}) },
] as const;

export const DEFAULT_PLATFORM_AUDIT_COLUMNS = PLATFORM_AUDIT_COLUMNS
  .filter((c) => !["entity_id", "correlation_id", "changes"].includes(c.key))
  .map((c) => c.key as string);

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toPlatformAuditCsv(
  rows: PlatformAuditRow[],
  columns: string[] = DEFAULT_PLATFORM_AUDIT_COLUMNS,
): string {
  const selected = PLATFORM_AUDIT_COLUMNS.filter((c) => columns.includes(c.key));
  const cols = selected.length > 0 ? selected : PLATFORM_AUDIT_COLUMNS;
  return [
    cols.map((c) => c.label).join(","),
    ...rows.map((r) => cols.map((c) => csvEscape(c.value(r))).join(",")),
  ].join("\n");
}
