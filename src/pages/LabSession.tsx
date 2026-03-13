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
  Upload,
  Power,
  AlertTriangle,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

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
  region: "East US",
  privateIp: "—",
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  duration: 120,
};

export default function LabSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState("");
  const [session, setSession] = useState<SessionInfo>(defaultSession);
  const [guacIframeUrl, setGuacIframeUrl] = useState("");
  const [guacConnectionId, setGuacConnectionId] = useState<string | null>(null);
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guacamole URL from search params (legacy) or from edge function
  const guacamoleUrl = guacIframeUrl || searchParams.get("guac_url") || "";

  // Check for vm_id param to create a real Guacamole session
  const vmId = searchParams.get("vm_id");

  const createGuacSession = useCallback(async (targetVmId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("guacamole-proxy", {
        body: { action: "create-session", vm_id: targetVmId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setGuacIframeUrl(data.iframe_url);
      setGuacConnectionId(data.connection_id);
      setDbSessionId(data.session_id);
      setSession((prev) => ({
        ...prev,
        protocol: data.protocol || prev.protocol,
        privateIp: data.vm_ip || prev.privateIp,
      }));
      setConnectionState("connected");
    } catch (err) {
      console.error("Failed to create Guacamole session:", err);
      setConnectionState("error");
    }
  }, []);

  // Init: create real session if vm_id is provided, otherwise demo mode
  useEffect(() => {
    if (vmId) {
      createGuacSession(vmId);
    } else {
      // Demo mode — simulate connection
      const timer = setTimeout(() => setConnectionState("connected"), 2500);
      return () => clearTimeout(timer);
    }
  }, [vmId, createGuacSession]);

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

  const handleReconnect = () => {
    setConnectionState("connecting");
    if (vmId) {
      createGuacSession(vmId);
    } else {
      setTimeout(() => setConnectionState("connected"), 2000);
    }
    toast({ title: "Reconnecting", description: "Attempting to reconnect to the lab session..." });
  };

  const handleClipboardSync = () => {
    toast({ title: "Clipboard synced", description: "Clipboard content sent to remote session." });
  };

  const handleEndSession = async () => {
    if (dbSessionId) {
      try {
        await supabase.functions.invoke("guacamole-proxy", {
          body: {
            action: "end-session",
            session_id: dbSessionId,
            connection_id: guacConnectionId,
          },
        });
      } catch (err) {
        console.error("Failed to end session cleanly:", err);
      }
    }
    toast({ title: "Session ended", description: "Your lab session has been terminated.", variant: "destructive" });
    navigate("/labs");
  };

  const connectionColor: Record<ConnectionState, string> = {
    connecting: "text-warning",
    connected: "text-success",
    disconnected: "text-muted-foreground",
    error: "text-destructive",
  };

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: "Connecting...",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection Error",
  };

  const isTimeLow = (() => {
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    return remaining < 10 * 60 * 1000 && remaining > 0;
  })();

  return (
    <div className="flex flex-col h-screen bg-background">
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
                {session.privateIp} · {session.region}
              </span>
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
        {/* Connecting Overlay */}
        <AnimatePresence>
          {connectionState === "connecting" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="h-12 w-12 rounded-full border-2 border-primary/20 border-t-primary mb-6"
              />
              <h2 className="text-lg font-semibold text-foreground mb-2">Connecting to Lab Session</h2>
              <p className="text-sm text-muted-foreground mb-1">Establishing secure {session.protocol} connection...</p>
              <p className="text-xs text-muted-foreground font-mono">{session.privateIp} · {session.region}</p>
              <div className="mt-8 space-y-2 text-xs text-muted-foreground">
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex items-center gap-2"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-success" />
                  Authenticating with gateway
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8 }}
                  className="flex items-center gap-2"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-success" />
                  Initializing remote display
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.5 }}
                  className="flex items-center gap-2"
                >
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  Rendering session...
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Overlay */}
        <AnimatePresence>
          {connectionState === "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background"
            >
              <div className="rounded-full bg-destructive/10 p-4 mb-4">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Connection Failed</h2>
              <p className="text-sm text-muted-foreground mb-6">Unable to establish connection to the remote session.</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => navigate("/labs")}>
                  Back to Labs
                </Button>
                <Button onClick={handleReconnect}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Connection
                </Button>
              </div>
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
                      <strong>Mixed content blocked:</strong> The Guacamole server is using HTTP but this page is HTTPS. 
                      The browser will block the iframe. Please enable SSL/TLS on your Guacamole server to fix this.
                    </span>
                  </div>
                )}
                {iframeLoadFailed && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background">
                    <div className="rounded-full bg-destructive/10 p-4 mb-4">
                      <AlertTriangle className="h-8 w-8 text-destructive" />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground mb-2">Failed to Load Session</h2>
                    <p className="text-sm text-muted-foreground mb-1 max-w-md text-center">
                      The remote desktop iframe could not be loaded. This may be caused by network issues, 
                      mixed content restrictions, or the Guacamole server being unreachable.
                    </p>
                    <p className="text-xs text-muted-foreground font-mono mb-6">{guacamoleUrl}</p>
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => navigate("/labs")}>
                        Back to Labs
                      </Button>
                      <Button onClick={() => { setIframeLoadFailed(false); handleReconnect(); }}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry Connection
                      </Button>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  src={guacamoleUrl}
                  className="h-full w-full border-0"
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
              /* Demo placeholder when no Guacamole URL */
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
                    <h3 className="text-lg font-semibold text-foreground">Guacamole Session Ready</h3>
                    <p className="text-sm text-muted-foreground">
                      The {session.protocol} session iframe will render here once your Guacamole gateway is configured with the proper authentication tokens.
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
                        <span className="text-muted-foreground">VM Size</span>
                        <span className="text-foreground font-mono">{session.vmSize}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">IP Address</span>
                        <span className="text-foreground font-mono">{session.privateIp}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Region</span>
                        <span className="text-foreground font-mono">{session.region}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Configure <code className="text-primary">GUACAMOLE_URL</code> and Azure secrets to enable live sessions.
                    </p>
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
            <span>Session: <code className="text-foreground">{sessionId || "demo"}</code></span>
            <span>VM: <code className="text-foreground">{session.vmSize}</code></span>
          </div>
          <div className="flex items-center gap-3">
            <span>{session.protocol} · {session.privateIp}</span>
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
