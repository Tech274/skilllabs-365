import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  Globe,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  AZURE_HOME_REGION,
  AWS_HOME_REGION,
  PROVISION_FALLBACK_CHAIN,
  buildFamilyQuotaRows,
  calcLabsFit,
  collectFamilyKeys,
  findMetric,
  formatSyncAgo,
  rankBankableRegions,
  remaining,
  zeroCapacityCopy,
  type FamilyQuotaRow,
  type QuotaMetric,
  type QuotaProvider,
  type RegionQuotaRow,
  type SkuNeeds,
} from "@/lib/cloud-quotas";
import { cn } from "@/lib/utils";

type SyncStatus = "ok" | "fail" | "not_connected" | "never";

type SyncStateRow = {
  provider: QuotaProvider;
  last_status: SyncStatus;
  last_reason: string | null;
  last_ok_at: string | null;
  last_fail_at: string | null;
  last_synced_at: string | null;
  home_region: string | null;
  snapshot: {
    sku?: SkuNeeds;
    regions?: RegionQuotaRow[];
    mode?: "live" | "stub";
    gap?: string;
    account?: { id?: string; displayName?: string } | null;
  };
};

type IncreaseRequest = {
  id: string;
  provider: QuotaProvider;
  region: string;
  resource_name: string;
  current_limit: number | null;
  requested_limit: number;
  justification: string | null;
  status: "draft" | "submitted" | "done";
  created_at: string;
  submitted_at: string | null;
};

const STATUS_META: Record<SyncStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: "text-success", label: "OK" },
  fail: { icon: XCircle, className: "text-destructive", label: "Failed" },
  not_connected: { icon: HelpCircle, className: "text-muted-foreground", label: "Not connected" },
  never: { icon: AlertTriangle, className: "text-warning", label: "Never synced" },
};

const emptyRequestForm = {
  region: AZURE_HOME_REGION,
  resource_name: "standardBSFamily",
  current_limit: "",
  requested_limit: "",
  justification: "",
  status: "draft" as "draft" | "submitted",
};

function normalizeRegions(raw: RegionQuotaRow[] | undefined, sku: SkuNeeds | undefined): RegionQuotaRow[] {
  if (!raw?.length) return [];
  const needs = sku || {
    vmSize: "Standard_B2s",
    vcpus: 2,
    familyKey: "standardBSFamily",
    familyLabel: "Standard BS Family vCPUs",
    source: "assumption" as const,
    sampleCount: 0,
  };
  return raw.map((r) => {
    const metrics = (r.metrics || []) as QuotaMetric[];
    let labsFit = r.labsFit;
    let limitingFactor = r.limitingFactor;
    if (typeof labsFit !== "number" || limitingFactor === undefined) {
      const calc = calcLabsFit(metrics, needs);
      labsFit = calc.labsFit;
      limitingFactor = calc.limitingFactor;
    }
    const families: FamilyQuotaRow[] =
      r.families && r.families.length > 0
        ? r.families
        : buildFamilyQuotaRows(metrics, needs.vcpus);
    return { ...r, metrics, families, labsFit, limitingFactor };
  });
}

export default function AdminCloudQuotas() {
  const { user } = useAuth();
  const [provider, setProvider] = useState<QuotaProvider>("azure");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<QuotaProvider | null>(null);
  const [states, setStates] = useState<Record<QuotaProvider, SyncStateRow | null>>({
    azure: null,
    aws: null,
  });
  const [requests, setRequests] = useState<IncreaseRequest[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyRequestForm);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted" | "done">("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const callQuotas = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("cloud-quotas", { body });
    if (error) throw new Error(error.message);
    if (data?.error && !data?.sync) throw new Error(String(data.error));
    return data;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, reqRes] = await Promise.all([
        callQuotas({ action: "status" }),
        supabase
          .from("quota_increase_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const providers = (statusRes?.providers ?? {}) as Record<string, SyncStateRow>;
      setStates({
        azure: (providers.azure as SyncStateRow) ?? null,
        aws: (providers.aws as SyncStateRow) ?? null,
      });

      if (reqRes.error) {
        // Table may not be migrated yet in local/preview — soft warn
        console.warn("quota_increase_requests:", reqRes.error.message);
        setRequests([]);
      } else {
        setRequests((reqRes.data as IncreaseRequest[]) ?? []);
      }
    } catch (e) {
      toast({
        title: "Failed to load cloud quotas",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = states[provider];
  const sku = active?.snapshot?.sku;
  const regions = useMemo(
    () => normalizeRegions(active?.snapshot?.regions, sku),
    [active?.snapshot?.regions, sku],
  );
  const top5 = useMemo(() => rankBankableRegions(regions, 5), [regions]);
  const homeRegion = provider === "azure" ? AZURE_HOME_REGION : AWS_HOME_REGION;
  const isStub = active?.snapshot?.mode === "stub" || active?.last_status === "not_connected";
  const familyKeys = useMemo(() => collectFamilyKeys(regions), [regions]);
  const filteredRegions = useMemo(() => {
    return regions.filter((r) => {
      if (regionFilter !== "all" && r.region !== regionFilter) return false;
      if (familyFilter !== "all") {
        const has = (r.families || []).some((f) => f.key === familyFilter)
          || (r.metrics || []).some((m) => m.key === familyFilter);
        if (!has) return false;
      }
      return true;
    });
  }, [regions, regionFilter, familyFilter]);
  const familyTableRows = useMemo(() => {
    const rows: Array<{
      region: string;
      displayName: string;
      isHome: boolean;
      family: FamilyQuotaRow;
    }> = [];
    for (const r of filteredRegions) {
      for (const f of r.families || []) {
        if (familyFilter !== "all" && f.key !== familyFilter) continue;
        rows.push({ region: r.region, displayName: r.displayName, isHome: r.isHome, family: f });
      }
    }
    rows.sort((a, b) => {
      if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
      if (a.family.labRelevant !== b.family.labRelevant) return a.family.labRelevant ? -1 : 1;
      if (b.family.remaining !== a.family.remaining) return b.family.remaining - a.family.remaining;
      return a.family.key.localeCompare(b.family.key) || a.region.localeCompare(b.region);
    });
    return rows;
  }, [filteredRegions, familyFilter]);
  const zeroHomeCopy = useMemo(() => {
    const home = regions.find((r) => r.isHome) || regions.find((r) => r.region === homeRegion);
    if (!home) return null;
    return zeroCapacityCopy({
      labsFit: home.labsFit,
      limitingFactor: home.limitingFactor,
      familyLabel: sku?.familyLabel || sku?.familyKey,
    });
  }, [regions, homeRegion, sku]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (r.provider !== provider) return false;
      if (statusFilter === "all") return true;
      return r.status === statusFilter;
    });
  }, [requests, provider, statusFilter]);

  const handleSync = async (target: QuotaProvider) => {
    setSyncing(target);
    try {
      const data = await callQuotas({ action: "sync", provider: target });
      const sync = data?.sync;
      if (sync?.status === "ok") {
        toast({ title: `${target.toUpperCase()} sync OK`, description: sync.reason });
      } else if (sync?.status === "not_connected") {
        toast({
          title: `${target.toUpperCase()} not connected`,
          description: sync.reason,
        });
      } else {
        toast({
          title: `${target.toUpperCase()} sync issue`,
          description: sync?.reason || data?.error || "Sync finished with errors",
          variant: "destructive",
        });
      }
      await load();
    } catch (e) {
      toast({
        title: "Sync failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
    }
  };

  const openRequestDialog = () => {
    setForm({
      ...emptyRequestForm,
      region: homeRegion,
      resource_name: provider === "azure" ? (sku?.familyKey || "standardBSFamily") : "L-1216C47A",
    });
    setDialogOpen(true);
  };

  const saveRequest = async () => {
    const requested = Number(form.requested_limit);
    if (!form.region.trim() || !form.resource_name.trim() || !Number.isFinite(requested) || requested <= 0) {
      toast({
        title: "Invalid form",
        description: "Region, resource name, and a positive requested limit are required.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        provider,
        region: form.region.trim(),
        resource_name: form.resource_name.trim(),
        current_limit: form.current_limit.trim() ? Number(form.current_limit) : null,
        requested_limit: requested,
        justification: form.justification.trim() || null,
        status: form.status,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
        submitted_at: form.status === "submitted" ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from("quota_increase_requests").insert(payload);
      if (error) throw new Error(error.message);
      toast({
        title: form.status === "submitted" ? "Request submitted" : "Draft saved",
        description: "Stored in Hub DB — no auto cloud ticket in v1.",
      });
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({
        title: "Could not save request",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (id: string) => {
    const { error } = await supabase
      .from("quota_increase_requests")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Marked done" });
    await load();
  };

  const markSubmitted = async (id: string) => {
    const { error } = await supabase
      .from("quota_increase_requests")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Marked submitted" });
    await load();
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cloud Quotas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Azure + AWS capacity center — home region{" "}
              <span className="font-mono text-foreground">
                {provider === "azure" ? AZURE_HOME_REGION : AWS_HOME_REGION}
              </span>
              {provider === "azure" && (
                <span className="text-muted-foreground"> (Central India — not southindia)</span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSync(provider)}
            disabled={syncing !== null}
          >
            {syncing === provider ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync now
          </Button>
        </div>

        <Tabs value={provider} onValueChange={(v) => {
            setProvider(v as QuotaProvider);
            setRegionFilter("all");
            setFamilyFilter("all");
          }}>
          <TabsList>
            <TabsTrigger value="azure" className="gap-2">
              <Cloud className="h-3.5 w-3.5" /> Azure
            </TabsTrigger>
            <TabsTrigger value="aws" className="gap-2">
              <Server className="h-3.5 w-3.5" /> AWS
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Sync health — both providers always visible */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(["azure", "aws"] as QuotaProvider[]).map((p) => {
            const row = states[p];
            const st = (row?.last_status || "never") as SyncStatus;
            const meta = STATUS_META[st];
            const Icon = meta.icon;
            const highlighted = p === provider;
            return (
              <Card
                key={p}
                className={cn(highlighted && "ring-1 ring-primary/40")}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      {p === "azure" ? <Cloud className="h-4 w-4 text-sky-400" /> : <Server className="h-4 w-4 text-orange-400" />}
                      {p.toUpperCase()} sync health
                    </CardTitle>
                    <Badge variant="outline" className={cn("gap-1", meta.className)}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                  </div>
                  <CardDescription>
                    Home: <span className="font-mono">{row?.home_region || (p === "azure" ? AZURE_HOME_REGION : AWS_HOME_REGION)}</span>
                    {" · "}
                    Last sync: {formatSyncAgo(row?.last_synced_at)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {row?.last_reason || "No sync yet."}
                  </p>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span>Last OK: {row?.last_ok_at ? formatSyncAgo(row.last_ok_at) : "—"}</span>
                    <span>Last fail: {row?.last_fail_at ? formatSyncAgo(row.last_fail_at) : "—"}</span>
                    {row?.snapshot?.mode && (
                      <Badge variant="secondary" className="text-[10px]">
                        {row.snapshot.mode === "live" ? "Live API" : "Stub"}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={highlighted ? "default" : "outline"}
                    disabled={syncing !== null}
                    onClick={() => handleSync(p)}
                  >
                    {syncing === p ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    )}
                    Sync now
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* SKU needs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> Lab SKU capacity basis
            </CardTitle>
            <CardDescription>
              Derived from published lab templates when present; otherwise Hub assumption constants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sku ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">VM size</span>
                  <p className="font-mono font-medium">{sku.vmSize}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">vCPU / lab</span>
                  <p className="font-mono font-medium">{sku.vcpus}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Family</span>
                  <p className="font-mono font-medium text-xs">{sku.familyKey}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Source</span>
                  <p className="font-medium">
                    {sku.source === "lab_templates"
                      ? `lab_templates (${sku.sampleCount} published)`
                      : "assumption (Standard_B2s / 2 vCPU / standardBSFamily)"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sync to populate SKU needs.</p>
            )}
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Launch Lab / provision fallback chain
              </p>
              <div className="flex flex-wrap gap-2">
                {PROVISION_FALLBACK_CHAIN.map((s) => (
                  <Badge
                    key={s.vmSize}
                    variant={sku?.familyKey === s.familyKey ? "default" : "outline"}
                    className="font-mono text-[10px]"
                    title={s.familyLabel}
                  >
                    {s.vmSize} → {s.familyKey}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {zeroHomeCopy && provider === "azure" && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-4 flex gap-3 items-start">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium text-foreground">Home region capacity is zero</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{zeroHomeCopy}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isStub && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="py-4 flex gap-3 items-start">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium text-foreground">
                  {provider.toUpperCase()} quota sync is stubbed
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {active?.snapshot?.gap || active?.last_reason ||
                    "Live Service Quotas API is not connected. Sync now refreshes stub state and timestamps only."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top 5 bankable */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" /> Top 5 bankable regions
            </CardTitle>
            <CardDescription>
              Ranked by usable lab capacity (remaining family vCPU / total cores / public IP vs Hub SKU needs).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {top5.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No bankable regions yet"
                description={
                  provider === "azure"
                    ? "Run Sync now to pull live Azure Compute + Network usages."
                    : "AWS quotas are not connected — region capacity cannot be ranked."
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {top5.map((r, i) => (
                  <div
                    key={r.region}
                    className={cn(
                      "rounded-lg border border-border bg-muted/30 p-3 space-y-2",
                      r.isHome && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px]">#{i + 1}</Badge>
                      {r.isHome && <Badge className="text-[10px]">Home</Badge>}
                    </div>
                    <p className="text-sm font-medium">{r.displayName}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{r.region}</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", r.labsFit <= 0 && "text-destructive")}>{r.labsFit}</p>
                    <p className="text-[10px] text-muted-foreground">
                      labs fit · limit: {r.limitingFactor || "—"}
                      {r.labsFit <= 0 ? " · no capacity" : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Region + family filters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Region & family filters</CardTitle>
            <CardDescription>
              Narrow family quotas and the region table. Home stays{" "}
              <span className="font-mono">{homeRegion}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Region</Label>
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="All regions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All regions</SelectItem>
                  {[...regions]
                    .sort((a, b) => {
                      if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
                      return a.region.localeCompare(b.region);
                    })
                    .map((r) => (
                      <SelectItem key={r.region} value={r.region}>
                        {r.displayName}{r.isHome ? " (home)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">VM family</Label>
              <Select value={familyFilter} onValueChange={setFamilyFilter}>
                <SelectTrigger className="w-[260px] h-8 text-xs font-mono">
                  <SelectValue placeholder="All families" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All families</SelectItem>
                  {familyKeys.map((k) => (
                    <SelectItem key={k} value={k} className="font-mono text-xs">
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(regionFilter !== "all" || familyFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="self-end h-8"
                onClick={() => {
                  setRegionFilter("all");
                  setFamilyFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Per-family capacity — full Azure family set */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> VM family quotas
            </CardTitle>
            <CardDescription>
              Full Azure Compute *Family set from sync (not BS-only). Limit / used / remaining +
              family-only labsFit at SKU vCPU. Lab-relevant families (BS, DSv3, DSv5, DASv5, …) listed first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {familyTableRows.length === 0 ? (
              <EmptyState
                icon={Cpu}
                title="No family quotas"
                description={
                  provider === "azure"
                    ? "Run Sync now to pull full Azure Compute family usages for bankable regions."
                    : "AWS family quotas are not connected."
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Region</TableHead>
                      <TableHead>Family</TableHead>
                      <TableHead>Used / Limit</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Labs fit</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {familyTableRows.map(({ region, displayName, isHome, family: f }) => {
                      const pct = f.limit > 0 ? Math.round((f.currentUsage / f.limit) * 100) : 0;
                      const zeroNote = zeroCapacityCopy({
                        labsFit: f.labsFit,
                        remaining: f.remaining,
                        familyLabel: f.name || f.key,
                      });
                      return (
                        <TableRow key={`${region}:${f.key}`} className={cn(isHome && "bg-primary/5")}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div>
                                <p className="text-sm font-medium">{displayName}</p>
                                <p className="text-[11px] font-mono text-muted-foreground">{region}</p>
                              </div>
                              {isHome && <Badge variant="outline" className="text-[10px]">Home</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-mono text-xs">{f.key}</p>
                              <p className="text-[11px] text-muted-foreground">{f.name}</p>
                              {f.labRelevant && (
                                <Badge variant="secondary" className="text-[10px]">Lab relevant</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 min-w-[120px]">
                              <div className="flex justify-between text-[11px] font-mono">
                                <span>{f.currentUsage}/{f.limit}</span>
                                <span className="text-muted-foreground">{pct}%</span>
                              </div>
                              <Progress value={pct} className="h-1.5" />
                            </div>
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-mono tabular-nums font-semibold",
                            f.remaining <= 0 && "text-destructive",
                          )}>
                            {f.remaining}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-semibold tabular-nums",
                            f.labsFit <= 0 && "text-destructive",
                          )}>
                            {f.labsFit}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground max-w-[280px]">
                            {zeroNote || (f.labRelevant ? "In provision fallback set" : "—")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Full region table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Full region table</CardTitle>
            <CardDescription>
              Used / limit / remaining for the SKU-basis family + cores + public IP, and how many lab VMs fit.
              Filtered by region/family selectors above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredRegions.length === 0 ? (
              <EmptyState
                icon={Server}
                title="No region snapshot"
                description="Sync this provider to populate the region table, or clear filters."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Region</TableHead>
                      <TableHead>Family vCPU</TableHead>
                      <TableHead>Total cores</TableHead>
                      <TableHead>Public IP</TableHead>
                      <TableHead className="text-right">Labs fit</TableHead>
                      <TableHead>Limiting</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...filteredRegions]
                      .sort((a, b) => {
                        if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
                        return b.labsFit - a.labsFit;
                      })
                      .map((r) => {
                        const familyKey = familyFilter !== "all"
                          ? familyFilter
                          : (sku?.familyKey || "standardBSFamily");
                        const family = findMetric(r.metrics || [], familyKey);
                        const cores = findMetric(r.metrics || [], "cores");
                        const pip = findMetric(r.metrics || [], "PublicIPAddresses")
                          || findMetric(r.metrics || [], "StaticPublicIPAddresses");
                        const pct = (m?: QuotaMetric) =>
                          m && m.limit > 0 ? Math.round((m.currentUsage / m.limit) * 100) : 0;
                        const cell = (m?: QuotaMetric) => {
                          if (!m) return <span className="text-muted-foreground">—</span>;
                          const rem = remaining(m);
                          return (
                            <div className="space-y-1 min-w-[120px]">
                              <div className="flex justify-between text-[11px] font-mono">
                                <span>{m.currentUsage}/{m.limit}</span>
                                <span className={cn("text-muted-foreground", rem <= 0 && "text-destructive")}>
                                  rem {rem}
                                </span>
                              </div>
                              <Progress value={pct(m)} className="h-1.5" />
                            </div>
                          );
                        };
                        return (
                          <TableRow key={r.region} className={cn(r.isHome && "bg-primary/5")}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div>
                                  <p className="text-sm font-medium">{r.displayName}</p>
                                  <p className="text-[11px] font-mono text-muted-foreground">{r.region}</p>
                                </div>
                                {r.isHome && <Badge variant="outline" className="text-[10px]">Home</Badge>}
                              </div>
                            </TableCell>
                            <TableCell>{cell(family)}</TableCell>
                            <TableCell>{cell(cores)}</TableCell>
                            <TableCell>{cell(pip)}</TableCell>
                            <TableCell className={cn(
                              "text-right font-semibold tabular-nums",
                              r.labsFit <= 0 && "text-destructive",
                            )}>
                              {r.labsFit}
                              {r.labsFit <= 0 && (
                                <p className="text-[10px] font-normal text-destructive/90 max-w-[160px] ml-auto leading-snug mt-1">
                                  No capacity for SKU basis
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                              {r.limitingFactor || "—"}
                            </TableCell>
                            <TableCell>
                              {r.syncOk ? (
                                <Badge variant="outline" className="text-success text-[10px]">OK</Badge>
                              ) : (
                                <Badge variant="outline" className="text-destructive text-[10px]" title={r.syncError || ""}>
                                  {r.syncError === "not_connected" ? "Stub" : "Fail"}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quota increase requests */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Quota increase requests</CardTitle>
                <CardDescription>
                  Capacity-center form stored in Hub DB (draft / submitted / done). v1 does not open a cloud ticket API.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={openRequestDialog}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> New request
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredRequests.length === 0 ? (
              <EmptyState
                icon={Plus}
                title="No requests yet"
                description={`Create a ${provider.toUpperCase()} quota increase draft for the capacity center.`}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Region</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Current → Requested</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.region}</TableCell>
                        <TableCell className="font-mono text-xs">{r.resource_name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.current_limit ?? "—"} → {r.requested_limit}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              r.status === "done" && "text-success",
                              r.status === "submitted" && "text-warning",
                            )}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {r.status === "draft" && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markSubmitted(r.id)}>
                              Submit
                            </Button>
                          )}
                          {r.status !== "done" && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markDone(r.id)}>
                              Done
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quota increase request ({provider.toUpperCase()})</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder={homeRegion}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Resource / family</Label>
              <Input
                value={form.resource_name}
                onChange={(e) => setForm({ ...form, resource_name: e.target.value })}
                placeholder="standardBSFamily"
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Current limit</Label>
                <Input
                  type="number"
                  value={form.current_limit}
                  onChange={(e) => setForm({ ...form, current_limit: e.target.value })}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Requested limit</Label>
                <Input
                  type="number"
                  value={form.requested_limit}
                  onChange={(e) => setForm({ ...form, requested_limit: e.target.value })}
                  placeholder="e.g. 64"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Justification</Label>
              <Textarea
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
                placeholder="Capacity center notes for Ops / cloud ticket (manual)."
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Initial status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as "draft" | "submitted" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveRequest} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
