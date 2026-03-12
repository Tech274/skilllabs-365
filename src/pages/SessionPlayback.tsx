import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Play, Pause, SkipForward, SkipBack, Clock, Activity } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface SessionEvent {
  id: string;
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

interface SessionInfo {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  connection_quality: string;
  disconnects: number;
  idle_minutes: number;
  region: string;
  user_id: string | null;
}

const EVENT_ICONS: Record<string, string> = {
  connect: "🟢",
  disconnect: "🔴",
  idle_start: "💤",
  idle_end: "⏰",
  clipboard_copy: "📋",
  clipboard_paste: "📌",
  file_upload: "📤",
  file_download: "📥",
  command: "⌨️",
  error: "⚠️",
  resize: "📐",
  focus: "👁️",
  blur: "👁️‍🗨️",
};

const EVENT_COLORS: Record<string, string> = {
  connect: "text-success",
  disconnect: "text-destructive",
  error: "text-destructive",
  idle_start: "text-warning",
  idle_end: "text-info",
  command: "text-primary",
};

export default function SessionPlayback() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      const [sessionRes, eventsRes] = await Promise.all([
        supabase.from("sessions").select("*").eq("id", sessionId).single(),
        supabase.from("session_events").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      ]);
      setSession(sessionRes.data);
      setEvents(eventsRes.data ?? []);

      if (sessionRes.data?.user_id) {
        const { data: profile } = await supabase
          .from("profiles").select("display_name").eq("user_id", sessionRes.data.user_id).single();
        setProfileName(profile?.display_name ?? "");
      }
      setLoading(false);
    };
    load();
  }, [sessionId]);

  // Playback timer
  useEffect(() => {
    if (!playing || currentIndex >= events.length - 1) {
      if (currentIndex >= events.length - 1) setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setCurrentIndex(i => i + 1), 800);
    return () => clearTimeout(timer);
  }, [playing, currentIndex, events.length]);

  const visibleEvents = useMemo(() => events.slice(0, currentIndex + 1), [events, currentIndex]);

  const sessionDuration = session?.ended_at && session?.started_at
    ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000)
    : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!session) {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Session not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Session Playback</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {profileName && `${profileName} · `}
              {new Date(session.started_at).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Session Info Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: "Status", value: session.status, color: session.status === "active" ? "text-success" : "text-primary" },
            { label: "Quality", value: session.connection_quality, color: session.connection_quality === "good" ? "text-success" : session.connection_quality === "fair" ? "text-warning" : "text-destructive" },
            { label: "Duration", value: sessionDuration !== null ? `${sessionDuration}m` : "Active" },
            { label: "Disconnects", value: session.disconnects, color: session.disconnects > 0 ? "text-destructive" : undefined },
            { label: "Events", value: events.length },
          ].map(item => (
            <Card key={item.label}>
              <CardContent className="p-3 text-center">
                <p className={cn("text-lg font-bold", item.color || "text-foreground")}>{item.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{item.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Playback Controls */}
        {events.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentIndex(0)}>
                  <SkipBack className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentIndex(events.length - 1)}>
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1">
                  <Slider
                    value={[currentIndex]}
                    max={Math.max(events.length - 1, 0)}
                    step={1}
                    onValueChange={([v]) => { setCurrentIndex(v); setPlaying(false); }}
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                  {currentIndex + 1} / {events.length}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Event Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Event Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No events recorded for this session.</p>
            ) : (
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                <AnimatePresence>
                  {visibleEvents.map((event, i) => {
                    const isActive = i === currentIndex;
                    return (
                      <motion.div
                        key={event.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn(
                          "flex items-start gap-3 p-2 rounded-lg transition-colors cursor-pointer",
                          isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
                        )}
                        onClick={() => { setCurrentIndex(i); setPlaying(false); }}
                      >
                        <span className="text-base mt-0.5">{EVENT_ICONS[event.event_type] ?? "📝"}</span>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm font-medium capitalize",
                            EVENT_COLORS[event.event_type] || "text-foreground"
                          )}>
                            {event.event_type.replace(/_/g, " ")}
                          </p>
                          {Object.keys(event.event_data).length > 0 && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {JSON.stringify(event.event_data)}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(event.created_at).toLocaleTimeString()}
                        </span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
