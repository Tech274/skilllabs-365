import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock, Download, Loader2, RefreshCw, Server, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  buildUsageReport,
  formatMinutes,
  istDay,
  usageLearnersCsv,
  usageWindowStart,
  type UsageProfileRow,
  type UsageReport,
  type UsageSessionRow,
  type UsageTemplateRow,
  ALL_VM_STATUSES,
} from "@/lib/usage-report";
import { dedupeBy, fetchAllForIds, fetchAllPages, PAGE_SIZE, type PageResult } from "@/lib/paged-query";

const RANGES = [7, 30] as const;
const SESSION_CAP = 5000;

/**
 * Thin usage page (SCRUM-22): live usage computed from sessions + VMs.
 * Admin-only (route guard + RLS "Admins … view all sessions / VMs").
 */
export function UsageSummaryPanel() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async (rangeDays: number) => {
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      const nowMs = Date.now();
      const since = usageWindowStart(rangeDays, nowMs).toISOString();
      const notes: string[] = [];
      // SCRUM-22 review follow-up: PostgREST caps every response at 1000 rows,
      // so page (SCRUM-107 helper) instead of asking for 5000 in one request.
      const [sessRes, tplRes, ...countRes] = await Promise.all([
        fetchAllPages<UsageSessionRow>(
          (from, to) =>
            supabase
              .from("sessions")
              .select("id, user_id, lab_template_id, started_at, ended_at, status")
              .gte("started_at", since)
              .order("started_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<PageResult<UsageSessionRow>>,
          PAGE_SIZE,
          SESSION_CAP,
        ),
        supabase.from("lab_templates").select("id, name"),
        // Exact status counts (head-only) instead of sampling every VM row ever created.
        ...ALL_VM_STATUSES.map((st) =>
          supabase.from("virtual_machines").select("id", { count: "exact", head: true }).eq("status", st),
        ),
      ]);
      if (sessRes.error) throw new Error(sessRes.error.message);
      const sessions = dedupeBy(sessRes.data, (s) => s.id);
      if (tplRes.error) notes.push(`Lab names unavailable: ${tplRes.error.message}`);

      const vmStatusCounts: Record<string, number> = {};
      let vmCountFailed = false;
      ALL_VM_STATUSES.forEach((st, i) => {
        const r = countRes[i] as { count: number | null; error: { message: string } | null };
        if (r.error) vmCountFailed = true;
        else vmStatusCounts[st] = r.count ?? 0;
      });
      if (vmCountFailed) notes.push("Some lab machine counts could not be loaded.");

      const userIds = [...new Set(sessions.map((s) => s.user_id).filter((v): v is string => !!v))];
      let profiles: UsageProfileRow[] = [];
      if (userIds.length) {
        // Chunked id lists: 1000 UUIDs in one URL fails once there are a few hundred learners.
        const profRes = await fetchAllForIds<UsageProfileRow, string>(userIds, (ids, from, to) =>
          supabase
            .from("profiles")
            .select("user_id, display_name, email")
            .in("user_id", ids)
            .order("user_id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<UsageProfileRow>>,
        );
        profiles = profRes.data;
        if (profRes.error) notes.push(`Some learner names could not be loaded: ${profRes.error.message}`);
      }
      setTruncated(sessRes.truncated);
      setWarnings(notes);
      setReport(
        buildUsageReport({
          sessions,
          vms: [],
          vmStatusCounts: vmCountFailed ? undefined : vmStatusCounts,
          templates: (tplRes.data ?? []) as UsageTemplateRow[],
          profiles,
          days: rangeDays,
          nowMs,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load usage");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const maxDayMinutes = useMemo(
    () => Math.max(1, ...(report?.byDay ?? []).map((d) => d.minutes)),
    [report],
  );

  const downloadCsv = () => {
    if (!report) return;
    // UTF-8 BOM so Excel shows non-ASCII learner names correctly.
    const blob = new Blob(["\uFEFF", usageLearnersCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-usage-${report.windowDays}d-${istDay(Date.now())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4" aria-labelledby="usage-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="usage-heading" className="text-lg font-semibold text-foreground">Lab usage</h2>
          <p className="text-xs text-muted-foreground">
            Live from lab sessions (IST days). Open sessions count up to now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={days === r ? "default" : "outline"}
              onClick={() => setDays(r)}
              aria-pressed={days === r}
            >
              Last {r} days
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => void load(days)} aria-label="Refresh usage">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!report || !report.byLearner.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading usage…
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load usage: {error}
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Sessions", value: String(report.totals.sessions), icon: Activity },
              { label: "Lab time", value: formatMinutes(report.totals.minutes), icon: Clock },
              { label: "Active learners", value: String(report.totals.learners), icon: Users },
              { label: "VMs live now", value: String(report.liveVms), icon: Server },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                <m.icon className="h-4 w-4 text-muted-foreground mb-2" />
                <p className="text-xl font-mono font-semibold text-foreground">{m.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{m.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Avg session {formatMinutes(report.totals.avgSessionMinutes)} · {report.totals.openSessions} open now
            {truncated ? ` · showing the latest ${SESSION_CAP} sessions only` : ""}
          </p>
          {warnings.length > 0 && (
            <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground">
              {warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-3">Lab time per day</h3>
            <ul className="space-y-1.5">
              {report.byDay.map((d) => (
                <li key={d.date} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 font-mono text-muted-foreground">{d.date}</span>
                  <div className="h-2 flex-1 rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary"
                      style={{ width: `${Math.round((d.minutes / maxDayMinutes) * 100)}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-foreground">
                    {formatMinutes(d.minutes)} · {d.sessions}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <h3 className="px-4 py-3 border-b border-border text-sm font-medium text-foreground">By lab</h3>
              {report.byLab.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No lab sessions in this window.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lab</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Learners</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byLab.map((l) => (
                      <TableRow key={l.templateId}>
                        <TableCell className="text-xs">{l.name}</TableCell>
                        <TableCell className="text-right text-xs">{l.sessions}</TableCell>
                        <TableCell className="text-right text-xs">{l.learners}</TableCell>
                        <TableCell className="text-right text-xs">{formatMinutes(l.minutes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <h3 className="px-4 py-3 border-b border-border text-sm font-medium text-foreground">
                Top learners
              </h3>
              {report.byLearner.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No learner sessions in this window.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Learner</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead className="text-right">Last start</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byLearner.slice(0, 20).map((l) => (
                      <TableRow key={l.userId}>
                        <TableCell className="text-xs">{l.name}</TableCell>
                        <TableCell className="text-right text-xs">{l.sessions}</TableCell>
                        <TableCell className="text-right text-xs">{formatMinutes(l.minutes)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {l.lastStartedAt ? istDay(l.lastStartedAt) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          {Object.keys(report.vmsByStatus).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-medium text-foreground mb-2">Lab machines by status (now)</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(report.vmsByStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <span key={status} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                      {status}: <span className="font-mono font-semibold">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export default UsageSummaryPanel;
