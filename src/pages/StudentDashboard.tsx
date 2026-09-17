import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Monitor, Terminal, Play, Loader2, Clock, History, CheckCircle2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProvisioningErrorPanel } from "@/components/ProvisioningErrorPanel";
import { readFunctionError } from "@/lib/function-error";
import { learnerConnectHoldCopy } from "@/lib/guac-connect";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { AiInsightCard } from "@/components/AiInsightCard";
import { AiChatPanel } from "@/components/AiChatPanel";
import { ProvisioningProgress } from "@/components/ProvisioningProgress";
import { useProvisioning } from "@/hooks/use-provisioning";
import { estimateLabCost } from "@/lib/azure-pricing";
import { DollarSign } from "lucide-react";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";
import { listGrants } from "@/lib/manual-grants.functions";
import { HUB_WHATSAPP_UPSELL, readStoredHandoff } from "@/lib/skilltrack-handoff";
import { MessageCircle } from "lucide-react";

type LabTemplate = Tables<"lab_templates">;
type Session = Tables<"sessions">;

type GrantRow = {
  active?: boolean;
  certification_slug?: string | null;
  asset_id?: string | null;
  note?: string | null;
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const provisioning = useProvisioning();
  const [labs, setLabs] = useState<LabTemplate[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchErrors, setLaunchErrors] = useState<Record<string, string>>({});
  const [launchErrorPayloads, setLaunchErrorPayloads] = useState<Record<string, { missing_fields?: string[]; setting?: string; suggestion?: string } | null>>({});
  const [hasLabGrant, setHasLabGrant] = useState<boolean | null>(null);
  const handoff = readStoredHandoff();

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [labRes, sessionRes, grants] = await Promise.all([
        supabase.from("lab_templates").select("*").eq("status", "published").order("name"),
        supabase.from("sessions").select("*").eq("user_id", user.id).order("started_at", { ascending: false }),
        listGrants({ userId: user.id }).catch(() => []),
      ]);
      setLabs(labRes.data ?? []);
      setSessions(sessionRes.data ?? []);
      const active = (grants || []).filter((g: GrantRow) => g.active !== false);
      const cert = (handoff?.cert || "").toLowerCase();
      if (!cert) {
        setHasLabGrant(active.length > 0);
      } else {
        const matched = active.filter(
          (g: GrantRow) =>
            (g.certification_slug || "").toLowerCase() === cert ||
            (g.asset_id || "").toLowerCase().includes(cert) ||
            (g.note || "").toLowerCase().includes(cert),
        );
        // Prefer cert-scoped; fall back to any active grant so Ops can use a blanket unlock.
        setHasLabGrant(matched.length > 0 || active.length > 0);
      }
      setLoading(false);
    };
    load();
  }, [user, handoff?.cert]);

  const handleLaunchLab = async (lab: LabTemplate) => {
    if (hasLabGrant === false) {
      toast({ title: "Lab access pending", description: "Ops must grant Hub access after payment.", variant: "destructive" });
      return;
    }
    setLaunchingId(lab.id);
    setLaunchErrors((prev) => ({ ...prev, [lab.id]: "" }));
    try {
      const { data, error } = await supabase.functions.invoke("provision-lab", {
        body: { lab_template_id: lab.id },
        headers: idempotencyHeaders(`provision:${lab.id}`),
      });
      if (error || data?.error) {
        if (data?.error) setLaunchErrorPayloads((prev) => ({ ...prev, [lab.id]: data }));
        throw new Error(await readFunctionError(error, data));
      }

      if (data.status === "running") {
        // Even when provision returns running, gate on a tokenized Guac URL before session.
        provisioning.startProvisioning(lab.id, lab.name, data.vm_id);
        toast({ title: "Almost ready", description: "Finishing secure desktop setup…" });
      } else {
        provisioning.startProvisioning(lab.id, lab.name, data.vm_id);
        toast({ title: "Lab starting", description: "Your lab is getting ready…" });
      }
    } catch (err: unknown) {
      resetIdempotency(`provision:${lab.id}`);
      const raw = err instanceof Error ? err.message : "Failed to provision VM. Please try again.";
      const message = learnerConnectHoldCopy(raw);
      setLaunchErrors((prev) => ({ ...prev, [lab.id]: message }));
      toast({ title: "Technical glitch", description: message, variant: "destructive" });
    } finally {
      setLaunchingId(null);
    }
  };

  const activeSessions = sessions.filter(s => s.status === "active").length;
  const completedSessions = sessions.filter(s => s.status === "completed").length;
  const totalTime = sessions.reduce((acc, s) => {
    if (s.ended_at && s.started_at) {
      return acc + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000;
    }
    return acc;
  }, 0);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Your labs and session history</p>
        </div>


        {(handoff?.handoff === "skilltrack" || hasLabGrant === false) && (
          <Card className={hasLabGrant ? "border-primary/30" : "border-amber-500/40"}>
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-sm">
                {hasLabGrant ? (
                  <>
                    <p className="font-medium text-foreground">Labs unlocked</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      SkillTrack handoff{handoff?.cert ? ` · cert ${handoff.cert}` : ""}
                      {handoff?.sku ? ` · sku ${handoff.sku}` : ""}. Ops grant is active.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground">Lab access pending</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Sign-in worked{handoff?.email ? ` as ${handoff.email}` : ""}. After payment,
                      Ops unlocks labs via Lab Grants (manual this cut — not Cloud Access Catalogue).
                      Message us if you already paid.
                    </p>
                  </>
                )}
              </div>
              {!hasLabGrant && (
                <a
                  href={HUB_WHATSAPP_UPSELL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp for access
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Available Labs", value: labs.length, icon: Monitor },
            { label: "Active Sessions", value: activeSessions, icon: Play },
            { label: "Completed", value: completedSessions, icon: CheckCircle2 },
            { label: "Total Time", value: `${Math.round(totalTime)}m`, icon: Clock },
          ].map((kpi, i) => (
            <motion.div key={kpi.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <kpi.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* AI Student Guidance */}
        <AiInsightCard
          type="student_guidance"
          data={{
            available_labs: labs.map(l => ({ name: l.name, protocol: l.protocol, duration: l.duration })),
            session_history: sessions.slice(0, 10).map(s => ({ status: s.status, region: s.region, started_at: s.started_at, connection_quality: s.connection_quality })),
            completed_count: completedSessions,
            total_time_minutes: Math.round(totalTime),
          }}
          title="AI Lab Assistant"
          buttonLabel="What should I do next?"
        />

        {/* Available Labs */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">Available Labs</h2>
          {labs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No labs available at this time. Check back later.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {labs.map((lab, i) => (
                <motion.div
                  key={lab.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {lab.protocol.toUpperCase() === "RDP" ? <Monitor className="h-4 w-4 text-primary" /> : <Terminal className="h-4 w-4 text-success" />}
                    <h3 className="text-sm font-semibold text-foreground">{lab.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{lab.description}</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-sm font-mono font-semibold text-foreground">{lab.duration}m</p>
                      <p className="text-[9px] text-muted-foreground uppercase">Duration</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-sm font-mono font-semibold text-foreground">{lab.protocol}</p>
                      <p className="text-[9px] text-muted-foreground uppercase">Protocol</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-sm font-mono font-semibold text-foreground">{estimateLabCost(lab.vm_size, lab.duration)}</p>
                      <p className="text-[9px] text-muted-foreground uppercase">Est. Cost</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-mono">{lab.vm_size}</Badge>
                    <Badge variant="outline" className="text-[10px]">{lab.region}</Badge>
                  </div>
                  {launchErrors[lab.id] && (
                    <ProvisioningErrorPanel
                      message={launchErrors[lab.id]}
                      payload={launchErrorPayloads[lab.id]}
                      learnerFacing
                    />
                  )}
                  {provisioning.isProvisioning && provisioning.labId === lab.id && (
                    <ProvisioningProgress
                      startedAt={provisioning.startedAt!}
                      vmId={provisioning.vmId}
                      onCancel={provisioning.cancelProvisioning}
                      cancelling={provisioning.cancelling}
                    />
                  )}
                  <Button size="sm" className="w-full gap-2" disabled={launchingId === lab.id || (provisioning.isProvisioning && provisioning.labId === lab.id)} onClick={() => handleLaunchLab(lab)}>
                    {(launchingId === lab.id || (provisioning.isProvisioning && provisioning.labId === lab.id)) ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning...</>
                    ) : launchErrors[lab.id] ? (
                      <><AlertCircle className="h-3.5 w-3.5" /> Retry Launch</>
                    ) : (
                      <><Play className="h-3.5 w-3.5" /> Launch Lab</>
                    )}
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Session History */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <History className="h-4 w-4" /> Session History
          </h2>
          {sessions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No sessions yet. Launch a lab to get started!
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">Date</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">Region</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Quality</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Duration</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Disconnects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.slice(0, 20).map(s => {
                        const duration = s.ended_at
                          ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
                          : null;
                        return (
                          <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <td className="p-3 text-foreground">{new Date(s.started_at).toLocaleDateString()}</td>
                            <td className="p-3 text-muted-foreground">{s.region}</td>
                            <td className="text-center p-3">
                              <Badge variant="outline" className={cn(
                                "text-[10px]",
                                s.status === "active" ? "text-success border-success/30" :
                                s.status === "completed" ? "text-primary border-primary/30" :
                                "text-muted-foreground"
                              )}>
                                {s.status}
                              </Badge>
                            </td>
                            <td className="text-center p-3">
                              <span className={cn(
                                "text-xs font-medium",
                                s.connection_quality === "good" ? "text-success" :
                                s.connection_quality === "fair" ? "text-warning" : "text-destructive"
                              )}>
                                {s.connection_quality}
                              </span>
                            </td>
                            <td className="text-center p-3 font-mono text-foreground">{duration !== null ? `${duration}m` : "—"}</td>
                            <td className="text-center p-3">
                              {s.disconnects > 0 ? (
                                <span className="text-destructive font-mono">{s.disconnects}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Floating AI Chat */}
      <AiChatPanel
        context={{
          available_labs: labs.map(l => ({ name: l.name, protocol: l.protocol, duration: l.duration, vm_size: l.vm_size, region: l.region })),
          session_history: sessions.slice(0, 10).map(s => ({ status: s.status, region: s.region, started_at: s.started_at, connection_quality: s.connection_quality, disconnects: s.disconnects })),
          completed_sessions: completedSessions,
          active_sessions: activeSessions,
          total_time_minutes: Math.round(totalTime),
        }}
      />
    </DashboardLayout>
  );
}
