import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type HandoffEvent = Tables<"skilltrack_handoff_events">;

export interface HandoffLead {
  key: string;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  skus: string[];
  certs: string[];
  leads: string[];
  invoices: string[];
  firstSeen: string;
  lastSeen: string;
  events: number;
}

export interface HandoffSummary {
  totalEvents: number;
  totalLeads: number;
  withEmail: number;
  withPhone: number;
  withSku: number;
  withInvoice: number;
  signedIn: number;
  last24h: number;
}

export async function listHandoffEvents(limit = 500): Promise<HandoffEvent[]> {
  const { data, error } = await supabase
    .from("skilltrack_handoff_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

function push(list: string[], value: string | null | undefined) {
  const v = (value || "").trim();
  if (v && !list.includes(v)) list.push(v);
}

export function groupLeads(events: HandoffEvent[]): HandoffLead[] {
  const map = new Map<string, HandoffLead>();
  for (const e of events) {
    const key = (e.email || "").trim().toLowerCase() || e.user_id || e.lead || e.id;
    const at = e.captured_at || e.created_at;
    let lead = map.get(key);
    if (!lead) {
      lead = {
        key, email: e.email, phone: e.phone, user_id: e.user_id,
        skus: [], certs: [], leads: [], invoices: [],
        firstSeen: at, lastSeen: at, events: 0,
      };
      map.set(key, lead);
    }
    lead.events += 1;
    lead.phone = lead.phone || e.phone;
    lead.user_id = lead.user_id || e.user_id;
    push(lead.skus, e.sku);
    push(lead.certs, e.cert);
    push(lead.leads, e.lead);
    push(lead.invoices, e.invoice);
    if (at < lead.firstSeen) lead.firstSeen = at;
    if (at > lead.lastSeen) lead.lastSeen = at;
  }
  return [...map.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

export function summarize(events: HandoffEvent[], leads: HandoffLead[]): HandoffSummary {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return {
    totalEvents: events.length,
    totalLeads: leads.length,
    withEmail: leads.filter((l) => !!l.email).length,
    withPhone: leads.filter((l) => !!l.phone).length,
    withSku: leads.filter((l) => l.skus.length > 0).length,
    withInvoice: leads.filter((l) => l.invoices.length > 0).length,
    signedIn: leads.filter((l) => !!l.user_id).length,
    last24h: events.filter((e) => new Date(e.created_at).getTime() >= dayAgo).length,
  };
}

export function invoiceRows(events: HandoffEvent[]) {
  const map = new Map<string, { invoice: string; email: string | null; phone: string | null; skus: string[]; certs: string[]; lastSeen: string }>();
  for (const e of events) {
    const inv = (e.invoice || "").trim();
    if (!inv) continue;
    const at = e.captured_at || e.created_at;
    let row = map.get(inv);
    if (!row) {
      row = { invoice: inv, email: e.email, phone: e.phone, skus: [], certs: [], lastSeen: at };
      map.set(inv, row);
    }
    row.email = row.email || e.email;
    row.phone = row.phone || e.phone;
    push(row.skus, e.sku);
    push(row.certs, e.cert);
    if (at > row.lastSeen) row.lastSeen = at;
  }
  return [...map.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

export function certificationRows(events: HandoffEvent[]) {
  const map = new Map<string, { cert: string; learners: string[]; skus: string[]; invoices: string[]; lastSeen: string }>();
  for (const e of events) {
    const cert = (e.cert || "").trim();
    if (!cert) continue;
    const at = e.captured_at || e.created_at;
    let row = map.get(cert.toLowerCase());
    if (!row) {
      row = { cert, learners: [], skus: [], invoices: [], lastSeen: at };
      map.set(cert.toLowerCase(), row);
    }
    push(row.learners, e.email || e.user_id);
    push(row.skus, e.sku);
    push(row.invoices, e.invoice);
    if (at > row.lastSeen) row.lastSeen = at;
  }
  return [...map.values()].sort((a, b) => b.learners.length - a.learners.length);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
