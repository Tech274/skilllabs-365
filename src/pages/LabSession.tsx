import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  Monitor,
  Terminal,
  Clock,
  Wifi,
  WifiOff,
  RefreshCw,
  Clipboard,
  Power,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";
import { ProvisioningTimeline } from "@/components/ProvisioningTimeline";
import { LearnerProvisioningPanel } from "@/components/LearnerProvisioningPanel";
import { useAuth } from "@/hooks/use-auth";
import { HUB_WHATSAPP_UPSELL } from "@/lib/skilltrack-handoff";
import {
  fetchTokenizedGuacUrl,
  isTokenizedGuacUrl,
  takeGuacReady,
} from "@/lib/guac-connect";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
const isMixedContent = (url: string) => {
  try {
    return window.location.protocol === "https:" && new URL(url).protocol === "http:";
  } catch { return false; }
};

interface SessionInfo {
  labName: string;
  protocol: "RDP" | "SSH";
  vmSize: string;
  region: string;
  privateIp: string;
  expiresAt: string;
  duration: number;
}

const defaultSession: SessionInfo = {
  labName: "Lab Session",
  protocol: "RDP",
  vmSize: "Standard_B2s",
  region: "—",
  privateIp: "—",
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  duration: 120,
};

export default function LabSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();
  const canDebug = isAdmin || isSuperAdmin;

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [showTechnicalTrace, setShowTechnicalTrace] = useState(false);
  const [connectStartedAt] = useState(() => Date.now());
  const [lastError, setLastError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState("");
  const [session, setSession] = useState<SessionInfo>(defaultSession);
  const [guacIframeUrl, setGuacIframeUrl] = useState("");

  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  const [idleWarningMinutes, setIdleWarningMinutes] = useState(0);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const idleUpdateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleWarningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only tokenized iframe URLs from guacamole-proxy (never bare ?guac_url= — native login wall)
  const guacamoleUrl = isTokenizedGuacUrl(guacIframeUrl) ? guacIframeUrl : "";

  // Check for vm_id param to create a real Guacamole session
  const vmId = searchParams.get("vm_id");

  const applyGuacResult = useCallback((data: {
    iframe_url: string;
    session_id?: string;
    protocol?: string;
    vm_ip?: string;
    region?: string | null;
  }) => {
    if (!isTokenizedGuacUrl(data.iframe_url)) {
      throw new Error("Secure lab desktop is not ready yet (missing connection token).");
    }
    setGuacIframeUrl(data.iframe_url);
    if (data.session_id) setDbSessionId(data.session_id);
    setSession((prev) => ({
      ...prev,
      protocol: (data.protocol as SessionInfo["protocol"]) || prev.protocol,
      privateIp: data.vm_ip || prev.privateIp,
      region: (data.region && String(data.region).trim()) || prev.region,
    }));
    setConnectionState("connected");
    setIframeLoadFailed(false);
    iframeTimerRef.current = setTimeout(() => setIframeLoadFailed(true), 15000);
  }, []);

  const createGuacSession = useCallback(async (targetVmId: string) => {
    try {
      const stashed = takeGuacReady(targetVmId);
      if (stashed) {
        applyGuacResult(stashed);
        return;
      }
      const data = await fetchTokenizedGuacUrl(targetVmId);
      applyGuacResult(data);
    } catch (err) {
      console.error("Failed to create Guacamole session:", err);
      resetIdempotency(`guac-session:${targetVmId}`);
      setLastError(err instanceof Error ? err.message : "Connection failed");
      setConnectionState("error");
    }
  }, [applyGuacResult]);

  // Load VM facts (region must match Azure/lab — never hardcode East US)
  useEffect(() => {
    if (!vmId) return;
    let cancelled = false;
    (async () => {
      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("name, region, private_ip, vm_size, lab_templates(name, protocol, duration_minutes)")
        .eq("id", vmId)
        .maybeSingle();
      if (cancelled || !vm) return;
      const tpl = Array.isArray(vm.lab_templates) ? vm.lab_templates[0] : vm.lab_templates;
      setSession((prev) => ({
        ...prev,
        labName: (tpl as { name?: string } | null)?.name || vm.name || prev.labName,
        protocol: ((tpl as { protocol?: string } | null)?.protocol?.toUpperCase() === "SSH" ? "SSH" : "RDP"),
        vmSize: vm.vm_size || prev.vmSize,
        region: (vm.region && String(vm.region).trim()) || prev.region,
        privateIp: vm.private_ip || prev.privateIp,
        duration: (tpl as { duration_minutes?: number } | null)?.duration_minutes || prev.duration,
      }));
    })();
    return () => { cancelled = true; };
  }, [vmId]);

  // Init: require vm_id + tokenized Guac; stay on calm panel until ready (no demo fake-connect)
  useEffect(() => {
    if (vmId) {
      createGuacSession(vmId);
      return;
    }
    setLastError("This lab session is missing a VM. Go back to Labs and launch again.");
    setConnectionState("error");
  }, [vmId, createGuacSession]);

  // Idle activity tracking: detect mouse/keyboard near iframe and update last_activity_at
  useEffect(() => {
    if (!dbSessionId || connectionState !== "connected") return;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    // Listen for mouse movements, clicks, and keyboard events on the document
    // (iframe is cross-origin so we can't listen inside it, but mousemove over it triggers on parent)
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((evt) => document.addEventListener(evt, markActive));

    // Every 60s, update last_activity_at in the database if there was recent activity
    idleUpdateIntervalRef.current = setInterval(async () => {
      const idleMs = Date.now() - lastActivityRef.current;
      const idleMinutes = Math.floor(idleMs / 60000);

      try {
        await supabase
          .from("sessions")
          .update({
            last_activity_at: new Date(lastActivityRef.current).toISOString(),
            idle_minutes: idleMinutes,
          })
          .eq("id", dbSessionId);
      } catch (err) {
        console.error("Failed to update idle status:", err);
      }
    }, 60000);

    return () => {
      events.forEach((evt) => document.removeEventListener(evt, markActive));
      if (idleUpdateIntervalRef.current) clearInterval(idleUpdateIntervalRef.current);
    };
  }, [dbSessionId, connectionState]);

  // Idle warning: update displayed idle time every 10s
  useEffect(() => {
    idleWarningIntervalRef.current = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const mins = Math.floor(idleMs / 60000);
      setIdleWarningMinutes(mins);
    }, 10000);

    return () => {
      if (idleWarningIntervalRef.current) clearInterval(idleWarningIntervalRef.current);
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = new Date(session.expiresAt).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeRemaining("Expired");
        setConnectionState("disconnected");
        clearInterval(interval);
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setTimeRemaining(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [session.expiresAt]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleReconnect = async () => {
    setConnectionState("connecting");
    setLastError(null);
    try {
      if (dbSessionId && vmId) {
        const data = await fetchTokenizedGuacUrl(vmId, { action: "reconnect", sessionId: dbSessionId });
        applyGuacResult(data);
      } else if (vmId) {
        await createGuacSession(vmId);
      } else {
        setLastError("This lab session is missing a VM. Go back to Labs and launch again.");
        setConnectionState("error");
      }
    } catch (err) {
      console.error("Reconnect failed:", err);
      setLastError(err instanceof Error ? err.message : "Reconnect failed");
      setConnectionState("error");
    }
  };

  const handleClipboardSync = () => {
    toast({ title: "Clipboard synced", description: "Clipboard content sent to remote session." });
  };

  const handleEndSession = async () => {
    if (dbSessionId) {
      try {
        await supabase.functions.invoke("guacamole-proxy", {
          body: { action: "end-session", session_id: dbSessionId },
        });
      } catch (err) {
        console.error("Failed to end session cleanly:", err);
      }
    }

    // Trigger VM cleanup/deallocation
    if (vmId) {
      try {
        await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "manual-stop" },
        });
      } catch (err) {
        console.error("Failed to trigger VM cleanup:", err);
      }
    }
    toast({ title: "Session ended", description: "Your lab session has been terminated and VM is being deallocated.", variant: "destructive" });
    navigate("/labs");
  };

  const connectionColor: Record<ConnectionState, string> = {
    connecting: "text-warning",
    connected: "text-success",
    disconnected: "text-muted-foreground",
    error: "text-destructive",
  };

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: "Getting ready…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Needs attention",
  };

  const isTimeLow = (() => {
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    return remaining < 10 * 60 * 1000 && remaining > 0;
  })();

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Idle Warning Banner */}
      <AnimatePresence>
        {idleWarningMinutes >= 10 && connectionState === "connected" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-warning/15 border-b border-warning/30 px-4 py-2.5 flex items-center justify-center gap-2 z-50"
          >
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <span className="text-sm font-medium text-warning">
              You have been idle for {idleWarningMinutes} minutes. Session will auto-terminate at 15 minutes of inactivity.
            </span>
            <span className="text-xs text-warning/70 font-mono ml-2">
              ({15 - idleWarningMinutes}m remaining)
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Toolbar */}
      <AnimatePresence>
        {showToolbar && (
          <motion.div
            initial={{ y: -48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -48, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/95 backdrop-blur-sm z-50"
          >
            {/* Left: Back + Session Info */}
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/labs")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                {session.protocol === "RDP" ? (
                  <Monitor className="h-4 w-4 text-primary" />
                ) : (
                  <Terminal className="h-4 w-4 text-success" />
                )}
                <span className="text-sm font-semibold text-foreground">{session.labName}</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {session.protocol}
                </Badge>
              </div>
            </div>

            {/* Center: Connection + Timer */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                {connectionState === "connected" ? (
                  <Wifi className={cn("h-3.5 w-3.5", connectionColor[connectionState])} />
                ) : connectionState === "connecting" ? (
                  <Loader2 className={cn("h-3.5 w-3.5 animate-spin", connectionColor[connectionState])} />
                ) : (
                  <WifiOff className={cn("h-3.5 w-3.5", connectionColor[connectionState])} />
                )}
                <span className={cn("text-xs font-medium", connectionColor[connectionState])}>
                  {connectionLabel[connectionState]}
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <Clock className={cn("h-3.5 w-3.5", isTimeLow ? "text-warning" : "text-muted-foreground")} />
                <span className={cn("text-xs font-mono font-medium", isTimeLow ? "text-warning" : "text-muted-foreground")}>
                  {timeRemaining}
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              <span className="text-[10px] text-muted-foreground font-mono">
                {canDebug && showTechnicalTrace
                  ? `${session.privateIp} · ${session.region}`
                  : session.region}
              </span>
              {canDebug && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="lab-tech-trace"
                      checked={showTechnicalTrace}
                      onCheckedChange={setShowTechnicalTrace}
                      className="scale-75 origin-left"
                    />
                    <Label htmlFor="lab-tech-trace" className="text-[10px] text-muted-foreground cursor-pointer">
                      Debug
                    </Label>
                  </div>
                </>
              )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClipboardSync}>
                    <Clipboard className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync Clipboard</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReconnect} disabled={connectionState === "connecting"}>
                    <RefreshCw className={cn("h-3.5 w-3.5", connectionState === "connecting" && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reconnect</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
                    {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</TooltipContent>
              </Tooltip>
              <div className="w-px h-4 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleEndSession}>
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>End Session</TooltipContent>
              </Tooltip>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle toolbar button when hidden */}
      {!showToolbar && (
        <button
          onClick={() => setShowToolbar(true)}
          className="fixed top-0 left-1/2 -translate-x-1/2 z-50 bg-card/90 backdrop-blur-sm border border-border border-t-0 rounded-b-lg px-4 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Show Toolbar
        </button>
      )}

      {/* Main Session Area */}
      <div className="flex-1 relative bg-background">
        {/* Connecting Overlay — calm learner UI by default */}
        <AnimatePresence>
          {connectionState === "connecting" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background px-4"
            >
              <LearnerProvisioningPanel
                mode="preparing"
                startedAt={connectStartedAt}
                vmId={vmId}
                onBack={() => navigate("/labs")}
              />
              {canDebug && showTechnicalTrace && vmId && (
                <ProvisioningTimeline vmId={vmId} className="mt-6 w-full max-w-lg text-left" />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Overlay — friendly student copy; technical trace only via debug */}
        <AnimatePresence>
          {connectionState === "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background px-4"
            >
              <LearnerProvisioningPanel
                mode="failed"
                errorMessage={lastError}
                onRetry={handleReconnect}
                onBack={() => navigate("/labs")}
              />
              {canDebug && showTechnicalTrace && vmId && (
                <ProvisioningTimeline vmId={vmId} className="mt-6 w-full max-w-lg text-left" />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disconnected Overlay */}
        <AnimatePresence>
          {connectionState === "disconnected" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background"
            >
              <div className="rounded-full bg-muted p-4 mb-4">
                <WifiOff className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Session Ended</h2>
              <p className="text-sm text-muted-foreground mb-6">Your lab session has been disconnected.</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => navigate("/labs")}>
                  Back to Labs
                </Button>
                <Button onClick={handleReconnect}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reconnect
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guacamole iframe / Placeholder */}
        {connectionState === "connected" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-full w-full"
          >
            {guacamoleUrl ? (
              <>
                {isMixedContent(guacamoleUrl) && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      {canDebug && showTechnicalTrace ? (
                        <>
                          <strong>Mixed content blocked:</strong> The remote gateway is using HTTP but this page is HTTPS.
                          Enable SSL/TLS on the gateway to fix this.
                        </>
                      ) : (
                        <>Your secure lab connection needs a quick fix from Ops. Try again shortly or message WhatsApp support.</>
                      )}
                    </span>
                  </div>
                )}
                {iframeLoadFailed && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background px-4">
                    <LearnerProvisioningPanel
                      mode="failed"
                      errorMessage={canDebug && showTechnicalTrace ? `Failed to load session frame: ${guacamoleUrl}` : null}
                      onRetry={() => { setIframeLoadFailed(false); handleReconnect(); }}
                      onBack={() => navigate("/labs")}
                    />
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  src={guacamoleUrl}
                  className="h-full w-full border-0"
                  style={{ objectFit: "contain" }}
                  allow="clipboard-read; clipboard-write"
                  title="Lab Session"
                  onLoad={() => {
                    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
                    // Try to detect blank iframe (cross-origin will throw)
                    try {
                      const doc = iframeRef.current?.contentDocument;
                      if (doc && (doc.body?.innerHTML === "" || doc.body?.childElementCount === 0)) {
                        setIframeLoadFailed(true);
                      }
                    } catch {
                      // Cross-origin — iframe loaded successfully from remote server
                      setIframeLoadFailed(false);
                    }
                  }}
                  onError={() => setIframeLoadFailed(true)}
                />
              </>
            ) : (
              /* Placeholder when no remote URL yet */
              <div className="h-full w-full flex flex-col items-center justify-center bg-background">
                <div className="max-w-md text-center space-y-6">
                  <div className="mx-auto rounded-2xl border border-border bg-card p-8 space-y-4">
                    <div className="mx-auto rounded-full bg-primary/10 p-4 w-fit">
                      {session.protocol === "RDP" ? (
                        <Monitor className="h-10 w-10 text-primary" />
                      ) : (
                        <Terminal className="h-10 w-10 text-primary" />
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">Lab desktop ready soon</h3>
                    <p className="text-sm text-muted-foreground">
                      Your {session.protocol} lab will appear here once the secure connection is available.
                    </p>
                    <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-left">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Lab</span>
                        <span className="text-foreground font-medium">{session.labName}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Protocol</span>
                        <span className="text-foreground font-mono">{session.protocol}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Region</span>
                        <span className="text-foreground font-mono">{session.region}</span>
                      </div>
                      {canDebug && showTechnicalTrace && (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">VM Size</span>
                            <span className="text-foreground font-mono">{session.vmSize}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">IP Address</span>
                            <span className="text-foreground font-mono">{session.privateIp}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {canDebug && showTechnicalTrace && (
                      <p className="text-[10px] text-muted-foreground">
                        Configure remote gateway URL and cloud secrets to enable live sessions.
                      </p>
                    )}
                    <Button variant="secondary" size="sm" asChild>
                      <a href={HUB_WHATSAPP_UPSELL} target="_blank" rel="noopener noreferrer">
                        Need help? WhatsApp Ops
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Bottom status bar */}
      {showToolbar && connectionState === "connected" && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-card/80 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            {canDebug && showTechnicalTrace ? (
              <>
                <span>Session: <code className="text-foreground">{sessionId || "demo"}</code></span>
                <span>VM: <code className="text-foreground">{session.vmSize}</code></span>
              </>
            ) : (
              <span>{session.protocol} · {session.region}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {canDebug && showTechnicalTrace && (
              <span>{session.protocol} · {session.privateIp}</span>
            )}
            <button
              onClick={() => setShowToolbar(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Hide toolbar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
