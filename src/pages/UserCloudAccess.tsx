import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Cloud, Clock, CreditCard, Calendar, ArrowLeft, Loader2, ExternalLink,
  RefreshCw, AlertCircle, CheckCircle2, Copy, KeyRound, LogOut, Timer,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  PROVIDER_META, SESSION_STATUS_STYLE, formatDuration, formatCredit,
  type AccessTemplate, type AccessSession, type CloudProvider,
} from "@/lib/cloud-access";

export default function UserCloudAccess() {
  const { id } = useParams<{ id?: string }>();
  return id ? <TemplateView id={id} /> : <CatalogueView />;
}

function CatalogueView() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<AccessTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("access_templates")
        .select("*")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      setTemplates((data || []).filter((template) =>
        ACTIVE_CLOUD_PROVIDERS.some((provider) => provider === template.provider),
      ));
      setLoading(false);
    })();
  }, []);

  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Cloud Access</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open a template, generate temporary session credentials, and connect to the cloud console.
          </p>
          <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-muted-foreground">
            {[
              "Pick a cloud access template",
              "Generate your temporary credentials",
              "Connect to the cloud console",
              "Finish before the timer ends",
            ].map((step, i) => (
              <li key={step} className="rounded-lg border border-border bg-card/40 px-3 py-2 flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-48 rounded-xl border border-border bg-card/40 animate-pulse" />)}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="No cloud access yet"
            description="You don't have any published cloud access templates assigned to you. Contact your administrator if you expected to see something here."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t, idx) => {
              const meta = PROVIDER_META[t.provider as CloudProvider];
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => navigate(`/cloud-access/${t.id}`)}
                  className="rounded-xl border border-border bg-card hover:border-primary/40 cursor-pointer overflow-hidden transition-all"
                >
                  <div className={`p-4 ${meta.bg} border-b border-border`}>
                    <span className={`text-xs font-mono font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">{t.name}</h3>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-muted-foreground">
                    <p className="line-clamp-2 min-h-[2rem]">{t.description || meta.tagline}</p>
                    <div className="flex items-center gap-3 pt-2">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {t.validity_days}d</span>
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDuration(t.session_duration_minutes)}</span>
                      <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" /> {formatCredit(t.credit_limit)}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function TemplateView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [tpl, setTpl] = useState<AccessTemplate | null>(null);
  const [session, setSession] = useState<AccessSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "refresh" | "end" | null>(null);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTpl = useCallback(async () => {
    setLoading(true);
    const [tplRes, sRes] = await Promise.all([
      supabase.from("access_templates").select("*").eq("id", id).maybeSingle(),
      supabase.from("access_sessions").select("*").eq("template_id", id).in("status", ["created", "active"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setTpl(tplRes.data || null);
    setSession(sRes.data || null);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchTpl(); }, [fetchTpl]);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // Auto-mark expired client-side; backend cleanup is authoritative
  useEffect(() => {
    if (!session || session.status !== "active") return;
    const remaining = new Date(session.expires_at).getTime() - now;
    if (remaining <= 0) fetchTpl();
  }, [now, session, fetchTpl]);

  const meta = tpl ? PROVIDER_META[tpl.provider as CloudProvider] : null;

  const callSession = async (action: "create" | "refresh" | "end", busyKey: typeof busy) => {
    setBusy(busyKey);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "create") body.template_id = id;
      if ((action === "refresh" || action === "end") && session) body.session_id = session.id;
      const { data, error } = await supabase.functions.invoke("cloud-access-session", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await fetchTpl();
      if (action === "create") toast({ title: "Session created", description: "Click Connect to open the console." });
      if (action === "refresh") toast({ title: "Credentials refreshed" });
      if (action === "end") toast({ title: "Session ended" });
    } catch (e) {
      toast({ title: `Failed to ${action}`, description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <DashboardLayout><div className="p-8 text-sm text-muted-foreground">Loading...</div></DashboardLayout>;
  if (!tpl || !meta) return <DashboardLayout><div className="p-8"><EmptyState icon={Cloud} title="Not available" description="This template is not published or not assigned to you." /></div></DashboardLayout>;

  const remainingMs = session ? Math.max(0, new Date(session.expires_at).getTime() - now) : 0;
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  const refreshWindow = session && session.status === "active" && remainingMs < 10 * 60 * 1000 && remainingMs > 0;

  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-6 max-w-4xl mx-auto w-full">
        <button onClick={() => navigate("/cloud-access")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Cloud Access
        </button>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border ${meta.bg} p-6`}>
          <span className={`text-xs font-mono font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
          <h1 className="text-2xl font-semibold text-foreground mt-1">{tpl.name}</h1>
          <p className="text-sm text-muted-foreground mt-2">{tpl.description || meta.tagline}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <Stat icon={Clock} label="Validity" value={`${tpl.validity_days}d`} />
            <Stat icon={Calendar} label="Session" value={formatDuration(tpl.session_duration_minutes)} />
            <Stat icon={CreditCard} label="Credit" value={formatCredit(tpl.credit_limit)} />
            <Stat icon={Cloud} label="Region" value={tpl.region || "—"} />
          </div>
        </motion.div>

        {!meta.implemented && (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-warning">{meta.label} sessions coming soon</p>
              <p className="text-xs text-muted-foreground mt-1">Session generation for {meta.label} is not yet implemented.</p>
            </div>
          </div>
        )}

        {!session ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Click <strong>Generate Link</strong> to create a temporary session and obtain a federated console URL.
            </p>
            <Button onClick={() => callSession("create", "generate")} disabled={busy === "generate" || !meta.implemented} size="lg">
              {busy === "generate" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Generate Link
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={SESSION_STATUS_STYLE[session.status]}>{session.status}</Badge>
                <span className="text-xs text-muted-foreground">Session {session.id.slice(0, 8)}</span>
              </div>
              <div className="font-mono text-2xl tabular-nums">
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </div>
            </div>

            {session.federated_url && session.status === "active" && (
              <Button asChild className="w-full" size="lg">
                <a href={session.federated_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" /> Connect to {meta.label} Console
                </a>
              </Button>
            )}

            {session.status === "active" && (
              <div className="rounded-lg border border-border/60 bg-background/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" /> Session access details
                </div>
                <CopyRow label="Sign-in link" value={session.federated_url || ""} />
                {Object.entries((session.scope ?? {}) as Record<string, unknown>)
                  .filter(([, v]) => typeof v === "string" || typeof v === "number")
                  .map(([k, v]) => (
                    <CopyRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
                  ))}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  These credentials are temporary and stop working when the timer reaches zero.
                </p>
              </div>
            )}

            {refreshWindow && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Your session ends soon. Save your work{tpl.refresh_allowed ? " or refresh the credentials to extend it" : ""}.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div><span className="text-muted-foreground">Started</span><div className="font-mono">{new Date(session.started_at).toLocaleTimeString()}</div></div>
              <div><span className="text-muted-foreground">Expires</span><div className="font-mono">{new Date(session.expires_at).toLocaleTimeString()}</div></div>
              <div><span className="text-muted-foreground">Refreshes</span><div className="font-mono">{session.refresh_count}</div></div>
              <div><span className="text-muted-foreground">Credit used</span><div className="font-mono">{formatCredit(session.credit_consumed)}</div></div>
            </div>

            {session.error_message && (
              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded p-2 font-mono">
                {session.error_message}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border">
              {tpl.refresh_allowed && refreshWindow && (
                <Button variant="outline" onClick={() => callSession("refresh", "refresh")} disabled={busy === "refresh"}>
                  {busy === "refresh" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Refresh Credentials
                </Button>
              )}
              <Button variant="destructive" onClick={() => callSession("end", "end")} disabled={busy === "end"} className="ml-auto">
                {busy === "end" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
                Sign out & end session
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">{value}</code>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast({ title: `Copied ${label}` });
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 border border-border/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-base font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}
