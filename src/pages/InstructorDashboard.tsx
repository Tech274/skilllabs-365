import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Monitor, Terminal, Users, Clock, Play, Loader2, BarChart3, TrendingUp, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from "recharts";
import { AiInsightCard } from "@/components/AiInsightCard";

type LabTemplate = Tables<"lab_templates">;

interface SessionRow {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  connection_quality: string;
  disconnects: number;
  idle_minutes: number;
  region: string;
  user_id: string | null;
  lab_template_id: string | null;
}

interface StudentProgress {
  userId: string;
  email: string;
  displayName: string;
  totalSessions: number;
  activeSessions: number;
  avgDuration: number;
  lastActive: string | null;
}

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--success, 142 76% 36%))", "hsl(var(--warning, 38 92% 50%))", "hsl(var(--destructive))"];

export default function InstructorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [labs, setLabs] = useState<LabTemplate[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  // Store labIds at component level for realtime filtering
  const [labIds, setLabIds] = useState<string[]>([]);

  const buildStudentProgress = async (sessionData: SessionRow[]) => {
    const studentMap = new Map<string, StudentProgress>();
    for (const s of sessionData) {
      if (!s.user_id) continue;
      if (!studentMap.has(s.user_id)) {
        studentMap.set(s.user_id, {
          userId: s.user_id, email: "", displayName: "",
          totalSessions: 0, activeSessions: 0, avgDuration: 0, lastActive: null,
        });
      }
      const sp = studentMap.get(s.user_id)!;
      sp.totalSessions++;
      if (s.status === "active") sp.activeSessions++;
      if (!sp.lastActive || s.started_at > sp.lastActive) sp.lastActive = s.started_at;
      if (s.ended_at && s.started_at) {
        const dur = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000;
        sp.avgDuration = ((sp.avgDuration * (sp.totalSessions - 1)) + dur) / sp.totalSessions;
      }
    }
    const userIds = Array.from(studentMap.keys());
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles").select("user_id, display_name, email").in("user_id", userIds);
      for (const p of profiles ?? []) {
        const sp = studentMap.get(p.user_id);
        if (sp) { sp.displayName = p.display_name; sp.email = p.email ?? ""; }
      }
    }
    return Array.from(studentMap.values());
  };

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: assignments } = await supabase
        .from("lab_assignments").select("lab_template_id").eq("instructor_id", user.id);
      const ids = assignments?.map(a => a.lab_template_id) ?? [];
      setLabIds(ids);

      if (ids.length === 0) {
        setLabs([]); setSessions([]); setStudents([]); setLoading(false); return;
      }

      const { data: labData } = await supabase.from("lab_templates").select("*").in("id", ids);
      setLabs(labData ?? []);

      const { data: sessionData } = await supabase.from("sessions").select("*").in("lab_template_id", ids);
      setSessions(sessionData ?? []);
      setStudents(await buildStudentProgress(sessionData ?? []));
      setLoading(false);
    };
    load();
  }, [user]);

  // Realtime subscription for live session updates
  useEffect(() => {
    if (labIds.length === 0) return;

    const channel = supabase
      .channel('instructor-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, async (payload) => {
        const record = (payload.new as SessionRow) || (payload.old as SessionRow);
        // Only process sessions for assigned labs
        if (record?.lab_template_id && !labIds.includes(record.lab_template_id)) return;

        // Re-fetch sessions for accuracy
        const { data: sessionData } = await supabase.from("sessions").select("*").in("lab_template_id", labIds);
        const newSessions = sessionData ?? [];
        setSessions(newSessions);
        setStudents(await buildStudentProgress(newSessions));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [labIds]);

  const handleLaunchLab = async (lab: LabTemplate) => {
    setLaunchingId(lab.id);
    try {
      const { data, error } = await supabase.functions.invoke("provision-lab", {
        body: { lab_template_id: lab.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "VM Ready", description: "Redirecting to your lab session..." });
      navigate(`/labs/session/${lab.id}?vm_id=${data.vm_id}`);
    } catch (err: any) {
      toast({ title: "Launch Failed", description: err.message || "Failed to provision VM.", variant: "destructive" });
    } finally {
      setLaunchingId(null);
    }
  };

  // Chart data
  const activeSessions = sessions.filter(s => s.status === "active").length;
  const completedSessions = sessions.filter(s => s.status === "completed").length;
  const totalDisconnects = sessions.reduce((a, s) => a + s.disconnects, 0);

  const qualityData = ["good", "fair", "poor"].map(q => ({
    name: q.charAt(0).toUpperCase() + q.slice(1),
    value: sessions.filter(s => s.connection_quality === q).length,
  })).filter(d => d.value > 0);

  const labSessionCounts = labs.map(lab => ({
    name: lab.name.length > 15 ? lab.name.slice(0, 15) + "…" : lab.name,
    sessions: sessions.filter(s => s.lab_template_id === lab.id).length,
  }));

  // Sessions over time (last 7 days)
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return {
      date: d.toLocaleDateString("en-US", { weekday: "short" }),
      count: sessions.filter(s => s.started_at.slice(0, 10) === key).length,
    };
  });

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Instructor Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Your assigned labs and student activity</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-medium text-success">Live</span>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Assigned Labs", value: labs.length, icon: Monitor },
            { label: "Active Sessions", value: activeSessions, icon: Users },
            { label: "Completed", value: completedSessions, icon: TrendingUp },
            { label: "Students", value: students.length, icon: BarChart3 },
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

        {/* AI Student Insights */}
        {students.length > 0 && (
          <AiInsightCard
            type="instructor_insight"
            data={{
              students: students.map(s => ({
                name: s.displayName,
                sessions: s.totalSessions,
                active: s.activeSessions,
                avg_duration: Math.round(s.avgDuration),
                last_active: s.lastActive,
              })),
              total_sessions: sessions.length,
              active_sessions: activeSessions,
              total_disconnects: totalDisconnects,
            }}
            title="AI Student Insights"
            buttonLabel="Analyze Progress"
          />
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sessions per Lab</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              {labSessionCounts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={labSessionCounts}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="sessions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No session data yet</div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sessions Trend (7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={last7}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Connection Quality + Disconnects */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Connection Quality</CardTitle>
            </CardHeader>
            <CardContent className="h-48">
              {qualityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={qualityData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={4}>
                      {qualityData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={30} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No data</div>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" /> Session Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted/50 p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{totalDisconnects}</p>
                  <p className="text-xs text-muted-foreground">Total Disconnects</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {sessions.length > 0 ? Math.round(sessions.reduce((a, s) => a + s.idle_minutes, 0) / sessions.length) : 0}m
                  </p>
                  <p className="text-xs text-muted-foreground">Avg Idle Time</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Assigned Labs */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">Your Labs</h2>
          {labs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No labs assigned to you yet. Contact an admin to get lab assignments.
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
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {lab.protocol.toUpperCase() === "RDP" ? <Monitor className="h-4 w-4 text-primary" /> : <Terminal className="h-4 w-4 text-success" />}
                      <h3 className="text-sm font-semibold text-foreground">{lab.name}</h3>
                    </div>
                    <span className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                      lab.status === "active" ? "bg-success/10 text-success" : lab.status === "draft" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                    )}>
                      {lab.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{lab.description}</p>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-sm font-mono font-semibold text-foreground">{lab.duration}m</p>
                      <p className="text-[9px] text-muted-foreground uppercase">Duration</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-sm font-mono font-semibold text-foreground">
                        {sessions.filter(s => s.lab_template_id === lab.id).length}
                      </p>
                      <p className="text-[9px] text-muted-foreground uppercase">Sessions</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-mono">{lab.vm_size}</Badge>
                    <Badge variant="outline" className="text-[10px]">{lab.protocol}</Badge>
                  </div>
                  {lab.status === "active" && (
                    <Button size="sm" className="w-full gap-2" disabled={launchingId === lab.id} onClick={() => handleLaunchLab(lab)}>
                      {launchingId === lab.id ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning...</>
                      ) : (
                        <><Play className="h-3.5 w-3.5" /> Launch Lab</>
                      )}
                    </Button>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Student Progress Table */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">Student Progress</h2>
          {students.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No student activity yet for your assigned labs.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">Student</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Sessions</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Active</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Avg Duration</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">Last Active</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">Playback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map(s => (
                        <tr key={s.userId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3">
                            <p className="font-medium text-foreground">{s.displayName || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{s.email}</p>
                          </td>
                          <td className="text-center p-3 font-mono">{s.totalSessions}</td>
                          <td className="text-center p-3">
                            {s.activeSessions > 0 ? (
                              <Badge variant="outline" className="text-success border-success/30">{s.activeSessions}</Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="text-center p-3 font-mono">{Math.round(s.avgDuration)}m</td>
                          <td className="text-right p-3 text-xs text-muted-foreground">
                            {s.lastActive ? new Date(s.lastActive).toLocaleDateString() : "—"}
                          </td>
                          <td className="text-center p-3">
                            {s.totalSessions > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs gap-1 h-7"
                                onClick={() => {
                                  const latestSession = sessions.find(sess => sess.user_id === s.userId);
                                  if (latestSession) navigate(`/sessions/${latestSession.id}/playback`);
                                }}
                              >
                                <Play className="h-3 w-3" /> Review
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
