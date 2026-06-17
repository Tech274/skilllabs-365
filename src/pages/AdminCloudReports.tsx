import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, Cloud, Users as UsersIcon, Layers, RefreshCcw, Clock, CreditCard, TrendingUp, Loader2,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { PROVIDER_META, type CloudProvider } from "@/lib/cloud-access";

type RangeKey = "7d" | "30d" | "90d" | "all";

interface SessionRow {
  id: string;
  user_id: string;
  template_id: string;
  batch_id: string | null;
  provider: CloudProvider;
  status: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  refresh_count: number;
  credit_consumed: number;
}
interface TemplateRow { id: string; name: string; provider: CloudProvider; }
interface BatchRow { id: string; name: string; template_id: string; }
interface ProfileRow { user_id: string; display_name: string | null; email: string | null; }

function rangeStart(r: RangeKey): Date | null {
  if (r === "all") return null;
  const d = new Date();
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  d.setDate(d.getDate() - days);
  return d;
}

export default function AdminCloudReports() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const start = rangeStart(range);
      let q = supabase.from("access_sessions").select("id,user_id,template_id,batch_id,provider,status,started_at,expires_at,ended_at,refresh_count,credit_consumed").order("started_at", { ascending: false }).limit(5000);
      if (start) q = q.gte("started_at", start.toISOString());
      const [sRes, tRes, bRes, pRes] = await Promise.all([
        q,
        supabase.from("access_templates").select("id,name,provider"),
        supabase.from("template_batches").select("id,name,template_id"),
        supabase.from("profiles").select("user_id,display_name,email").limit(2000),
      ]);
      setSessions((sRes.data as SessionRow[]) ?? []);
      setTemplates(tRes.data ?? []);
      setBatches(bRes.data ?? []);
      setProfiles(pRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [range]);

  const tplById  = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t])), [templates]);
  const batchById= useMemo(() => Object.fromEntries(batches.map((b) => [b.id, b])), [batches]);
  const userById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.user_id, p])), [profiles]);

  const totals = useMemo(() => {
    const total = sessions.length;
    const active = sessions.filter((s) => s.status === "active").length;
    const expired = sessions.filter((s) => s.status === "expired").length;
    const failed = sessions.filter((s) => s.status === "failed").length;
    const refreshes = sessions.reduce((a, s) => a + (s.refresh_count || 0), 0);
    const credit = sessions.reduce((a, s) => a + Number(s.credit_consumed || 0), 0);
    return { total, active, expired, failed, refreshes, credit };
  }, [sessions]);

  const byProvider = useMemo(() => groupBy(sessions, (s) => s.provider), [sessions]);
  const byTemplate = useMemo(() => groupBy(sessions, (s) => s.template_id), [sessions]);
  const byBatch    = useMemo(() => groupBy(sessions, (s) => s.batch_id ?? "(no batch)"), [sessions]);
  const byUser     = useMemo(() => groupBy(sessions, (s) => s.user_id), [sessions]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
              <BarChart3 className="h-7 w-7 text-primary" /> Cloud Access Reports
            </h1>
            <p className="mt-1 text-muted-foreground">Per-user, per-template, per-batch, and per-provider session usage.</p>
          </div>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Kpi icon={<Layers />}      label="Sessions"  value={totals.total} />
          <Kpi icon={<TrendingUp />}  label="Active"    value={totals.active}  accent="text-emerald-400" />
          <Kpi icon={<Clock />}       label="Expired"   value={totals.expired} accent="text-amber-400" />
          <Kpi icon={<RefreshCcw />}  label="Refreshes" value={totals.refreshes} />
          <Kpi icon={<CreditCard />}  label="Credit"    value={totals.credit.toFixed(2)} />
          <Kpi icon={<BarChart3 />}   label="Failed"    value={totals.failed} accent="text-rose-400" />
        </div>

        <Tabs defaultValue="provider">
          <TabsList>
            <TabsTrigger value="provider"><Cloud className="mr-1.5 h-3.5 w-3.5" />Provider</TabsTrigger>
            <TabsTrigger value="template"><Layers className="mr-1.5 h-3.5 w-3.5" />Template</TabsTrigger>
            <TabsTrigger value="batch"><Layers className="mr-1.5 h-3.5 w-3.5" />Batch</TabsTrigger>
            <TabsTrigger value="user"><UsersIcon className="mr-1.5 h-3.5 w-3.5" />User</TabsTrigger>
          </TabsList>

          <TabsContent value="provider">
            <ReportTable rows={Object.entries(byProvider).map(([k, list]) => ({
              key: k, label: PROVIDER_META[k as CloudProvider]?.label ?? k, list,
            }))} firstColumn="Provider" />
          </TabsContent>

          <TabsContent value="template">
            <ReportTable rows={Object.entries(byTemplate).map(([k, list]) => ({
              key: k, label: tplById[k]?.name ?? k, list,
            }))} firstColumn="Template" />
          </TabsContent>

          <TabsContent value="batch">
            <ReportTable rows={Object.entries(byBatch).map(([k, list]) => ({
              key: k, label: batchById[k]?.name ?? k, list,
            }))} firstColumn="Batch" />
          </TabsContent>

          <TabsContent value="user">
            <ReportTable rows={Object.entries(byUser).map(([k, list]) => ({
              key: k, label: userById[k]?.display_name || userById[k]?.email || k.slice(0, 8), list,
            }))} firstColumn="User" />
          </TabsContent>
        </Tabs>
      </motion.div>
    </DashboardLayout>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={`text-muted-foreground ${accent ?? ""}`}>{icon}</span>
        </div>
        <p className={`mt-2 text-2xl font-semibold ${accent ?? "text-foreground"}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

interface RowGroup { key: string; label: string; list: SessionRow[] }

function ReportTable({ rows, firstColumn }: { rows: RowGroup[]; firstColumn: string }) {
  const sorted = [...rows].sort((a, b) => b.list.length - a.list.length);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Breakdown by {firstColumn}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{firstColumn}</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Expired</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Refreshes</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No sessions in this window.</TableCell></TableRow>
            )}
            {sorted.map((r) => {
              const active  = r.list.filter((s) => s.status === "active").length;
              const expired = r.list.filter((s) => s.status === "expired").length;
              const failed  = r.list.filter((s) => s.status === "failed").length;
              const refresh = r.list.reduce((a, s) => a + (s.refresh_count || 0), 0);
              const credit  = r.list.reduce((a, s) => a + Number(s.credit_consumed || 0), 0);
              return (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right">{r.list.length}</TableCell>
                  <TableCell className="text-right"><Badge variant="outline" className="border-emerald-500/40 text-emerald-400">{active}</Badge></TableCell>
                  <TableCell className="text-right text-amber-400">{expired}</TableCell>
                  <TableCell className="text-right text-rose-400">{failed}</TableCell>
                  <TableCell className="text-right">{refresh}</TableCell>
                  <TableCell className="text-right">{credit.toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
