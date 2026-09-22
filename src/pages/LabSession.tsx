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
  KeyRound,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LabWorkbenchPanel } from "@/components/LabWorkbenchPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  needsRemint,
  remintAndWaitRunning,
  REMINT_CALM_COPY,
  REMINT_FAIL_CODE,
} from "@/lib/lab-remint";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";
import { ProvisioningTimeline } from "@/components/ProvisioningTimeline";
import { LearnerProvisioningPanel } from "@/components/LearnerProvisioningPanel";
import { useAuth } from "@/hooks/use-auth";
import { HUB_WHATSAPP_UPSELL } from "@/lib/skilltrack-handoff";
import {
  checkGuacSessionReady,
  fetchTokenizedGuacUrl,
  isTokenizedGuacUrl,
  clearGuacReady,
  isLabPortUnreachable,
} from "@/lib/guac-connect";
import {
  GUAC_IFRAME_ALLOW,
  GUAC_KEEP_FOCUS_ATTR,
  bindGuacamoleFocus,
  defaultTypingAssist,
  focusGuacamoleFrame,
  showTypingGate,
} from "@/lib/guac-keyboard";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
/** Cap learner retries so Guac error pages never spin reconnect forever. */
const MAX_LEARNER_RECONNECTS = 3;
/** One silent fresh create-session after detected Guac chrome; then calm Hub error. */
const MAX_GUAC_CHROME_RETRIES = 1;
/**
 * Readiness comes ONLY from the server (guacamole-proxy connection-health):
 * guac.* is cross-origin, so its DOM is opaque and must never be inspected.
 */
const GUAC_DESKTOP_POLL_MS = 1_000;
const GUAC_DESKTOP_CLEAN_TICKS = 3;
const GUAC_DESKTOP_CONFIRM_TIMEOUT_MS = 30_000;
/** Gateway says the lab port is not answering yet — calm Hub wait, then retry. */
const MAX_PORT_WAIT_RETRIES = 6;
const PORT_WAIT_RETRY_MS = 10_000;
/** Watchdog interval for Guac chrome appearing AFTER the desktop was confirmed. */
const GUAC_CHROME_WATCH_MS = 2_000;
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

/** Placeholder until VM facts load — never a stale module-load clock (fake Expired UI). */
const defaultSession: SessionInfo = {
  labName: "Lab Session",
  protocol: "RDP",
  vmSize: "Standard_B2s",
  region: "—",
  privateIp: "—",
  expiresAt: "",
  duration: 0,
};

function deriveExpiresAt(opts: {
  vmExpiresAt?: string | null;
  durationMinutes?: number | null;
  isPersistent?: boolean;
}): string {
  if (opts.vmExpiresAt) return opts.vmExpiresAt;
  const mins = Number(opts.durationMinutes ?? 0);
  if (!opts.isPersistent && mins > 0) {
    return new Date(Date.now() + mins * 60 * 1000).toISOString();
  }
  // Persistent / unknown: far future so Connected never flips to Expired on a fake 2h clock.
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

export default function LabSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const [labTemplateId, setLabTemplateId] = useState<string | null>(null);
  /** Persistent labs keep their allocation: Leave soft-stops (deallocate), Start remints same VM. */
  const [isPersistentLab, setIsPersistentLab] = useState(false);
  /** VM facts (persistence + power state) must be loaded before Leave/Connect act. */
  const [vmFactsLoaded, setVmFactsLoaded] = useState(false);
  const [vmStatus, setVmStatus] = useState<string | null>(null);
  const [reminting, setReminting] = useState(false);
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
  /**
   * Typing assist is on for SSH and RDP. Guacamole's cross-origin iframe does
   * not keep keyboard focus for either protocol unless the parent refocuses it.
   */
  const [keyboardHelper, setKeyboardHelper] = useState(true);
  const keyboardHelperTouchedRef = useRef(false);
  /** True after a click or keydown has focused the iframe during a user gesture. */
  const [typingArmed, setTypingArmed] = useState(false);


  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const dbSessionIdRef = useRef<string | null>(null);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  /** Guac shell loaded (cross-origin) but remote SSH/RDP may still be failing inside the iframe. */
  const [awaitingDesktop, setAwaitingDesktop] = useState(false);
  /** Independent proof bit: a tokenized URL or iframe load can never reveal the frame. */
  const [desktopConfirmed, setDesktopConfirmed] = useState(false);
  const [idleWarningMinutes, setIdleWarningMinutes] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  /** Native Guacamole chrome is a FAIL; retry with a fresh tokenized session at most twice. */
  const guacChromeRetryRef = useRef(0);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guacAttemptRef = useRef(0);
  const guacFailureInFlightRef = useRef(false);
  const portWaitRetryRef = useRef(0);
  const portWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while the gateway is still waiting for the lab's RDP/SSH port. */
  const [waitingForLabPort, setWaitingForLabPort] = useState(false);
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
    // Mixed content (http Guac on https Hub) blanks the iframe — fail closed
    try {
      const u = new URL(data.iframe_url);
      if (typeof window !== "undefined" && window.location.protocol === "https:" && u.protocol === "http:") {
        throw new Error("Secure lab gateway URL must be HTTPS (mixed content blocked).");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("HTTPS")) throw e;
    }
    setGuacIframeUrl(data.iframe_url);
    if (data.session_id) {
      dbSessionIdRef.current = data.session_id;
      setDbSessionId(data.session_id);
    }
    setSession((prev) => ({
      ...prev,
      protocol: (data.protocol as SessionInfo["protocol"]) || prev.protocol,
      privateIp: data.vm_ip || prev.privateIp,
      region: (data.region && String(data.region).trim()) || prev.region,
    }));
    // Do not claim "Connected" until the iframe document loads. Cross-origin Guac
    // error pages still fire onLoad — we only treat that as shell-ready, then settle.
    setConnectionState("connecting");
    setDesktopConfirmed(false);
    setIframeLoadFailed(false);
    setAwaitingDesktop(true);
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    if (desktopSettleRef.current) clearTimeout(desktopSettleRef.current);
    // If the Guac document never loads, fail closed (calm panel) — no infinite spin.
    iframeTimerRef.current = setTimeout(() => {
      setIframeLoadFailed(true);
      setAwaitingDesktop(false);
      setConnectionState("error");
      setLastError("secure_desktop_frame_timeout");
    }, 20000);
  }, []);

  /**
   * Always mint a FRESH tokenized session. After Leave, any stashed URL or old
   * session_id points at a torn-down Guacamole connection, which lands the
   * learner on the Apache Guacamole username/password wall. So: drop the stash,
   * reset the idempotency key, and create-session with vm_id every time.
   */
  const createGuacSession = useCallback(async (targetVmId: string) => {
    try {
      guacAttemptRef.current += 1;
      if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
      if (desktopSettleRef.current) clearTimeout(desktopSettleRef.current);
      clearGuacReady(targetVmId); // never reuse a stashed URL on return Connect
      dbSessionIdRef.current = null;
      setDbSessionId(null);
      setGuacIframeUrl("");
      setDesktopConfirmed(false);
      setAwaitingDesktop(true);
      setConnectionState("connecting");
      setIframeLoadFailed(false);
      setLastError(null);
      resetIdempotency(`guac-session:${targetVmId}`);
      const data = await fetchTokenizedGuacUrl(targetVmId);
      applyGuacResult(data);
      setWaitingForLabPort(false);
      portWaitRetryRef.current = 0;
    } catch (err) {
      console.error("Failed to create Guacamole session:", err);
      resetIdempotency(`guac-session:${targetVmId}`);
      // 503 rdp_unreachable / ssh_unreachable: the desktop was never minted.
      // Keep the calm Hub overlay, never touch the iframe, and retry quietly.
      if (isLabPortUnreachable(err) && portWaitRetryRef.current < MAX_PORT_WAIT_RETRIES) {
        portWaitRetryRef.current += 1;
        setWaitingForLabPort(true);
        setAwaitingDesktop(true);
        setGuacIframeUrl("");
        setConnectionState("connecting");
        setLastError(null);
        if (portWaitTimerRef.current) clearTimeout(portWaitTimerRef.current);
        portWaitTimerRef.current = setTimeout(() => {
          void createGuacSessionRef.current?.(targetVmId);
        }, PORT_WAIT_RETRY_MS);
        return;
      }
      setWaitingForLabPort(false);
      setAwaitingDesktop(false);
      setLastError(
        isLabPortUnreachable(err)
          ? "secure_desktop_port_wait"
          : err instanceof Error ? err.message : "Connection failed",
      );
      setConnectionState("error");
    }
  }, [applyGuacResult]);

  const createGuacSessionRef = useRef<typeof createGuacSession | null>(null);
  useEffect(() => {
    createGuacSessionRef.current = createGuacSession;
    return () => {
      if (portWaitTimerRef.current) clearTimeout(portWaitTimerRef.current);
    };
  }, [createGuacSession]);

  // Load VM facts (region must match Azure/lab — never hardcode East US)
  useEffect(() => {
    if (!vmId) return;
    let cancelled = false;
    (async () => {
      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("status, region, private_ip, vm_size, expires_at, lab_template_id, lab_templates(name, protocol, duration, is_persistent)")
        .eq("id", vmId)
        .maybeSingle();
      if (cancelled || !vm) return;
      const tpl = Array.isArray(vm.lab_templates) ? vm.lab_templates[0] : vm.lab_templates;
      const isPersistent = Boolean((tpl as { is_persistent?: boolean } | null)?.is_persistent);
      const duration = Number((tpl as { duration?: number } | null)?.duration ?? 0);
      setLabTemplateId(vm.lab_template_id ?? null);
      setIsPersistentLab(isPersistent);
      // Persistence + power state must be known BEFORE Leave or Connect run.
      setVmStatus(String((vm as { status?: string }).status ?? "").toLowerCase());
      setVmFactsLoaded(true);
      setSession((prev) => ({
        ...prev,
        labName: (tpl as { name?: string } | null)?.name || prev.labName,
        protocol: ((tpl as { protocol?: string } | null)?.protocol?.toUpperCase() === "SSH" ? "SSH" : "RDP"),
        vmSize: vm.vm_size || prev.vmSize,
        region: (vm.region && String(vm.region).trim()) || prev.region,
        privateIp: vm.private_ip || prev.privateIp,
        duration: duration || prev.duration,
        // P0c: derive from VM expires_at or template.duration — kill fake 2h Connected+Expired.
        expiresAt: deriveExpiresAt({
          vmExpiresAt: (vm as { expires_at?: string | null }).expires_at,
          durationMinutes: duration,
          isPersistent,
        }),
      }));
    })();
    return () => { cancelled = true; };
  }, [vmId]);

  // Same default for Ubuntu SSH and Windows RDP unless the learner chose.
  useEffect(() => {
    if (keyboardHelperTouchedRef.current) return;
    setKeyboardHelper(defaultTypingAssist(session.protocol));
  }, [session.protocol]);

  // A new tokenized session is a new browsing context and needs a fresh gesture.
  useEffect(() => {
    setTypingArmed(false);
  }, [guacamoleUrl]);

  // Click, keydown, and returning to the tab hand focus to the iframe.
  // No timers and no contentWindow.focus() — those miss the user gesture and
  // blur Guacamole's InputSink for both SSH and RDP.
  useEffect(() => {
    if (!keyboardHelper || connectionState !== "connected" || !desktopConfirmed || !guacamoleUrl) return;
    return bindGuacamoleFocus({
      document,
      window,
      getIframe: () => iframeRef.current,
      onArm: () => setTypingArmed(true),
    });
  }, [keyboardHelper, connectionState, desktopConfirmed, guacamoleUrl]);

  // Init: remint first when the allocation is powered off, then require tokenized Guac.
  // Never open Guacamole (or claim Connected) while deallocated/stopped/starting.
  useEffect(() => {
    if (!vmId) {
      setLastError("This lab session is missing a VM. Go back to Labs and launch again.");
      setConnectionState("error");
      return;
    }
    if (!vmFactsLoaded) return;
    let cancelled = false;
    (async () => {
      if (needsRemint(vmStatus)) {
        setReminting(true);
        setConnectionState("connecting");
        try {
          await remintAndWaitRunning({
            vmId,
            labTemplateId,
            alreadyStarting: vmStatus === "starting",
          });
        } catch (err) {
          console.error("[remint] failed:", err);
          if (cancelled) return;
          setReminting(false);
          const detail = err instanceof Error ? err.message : REMINT_FAIL_CODE;
          setLastError(detail);
          setConnectionState("error");
          // P0b: always surface detail/code/aws_state (do not hide behind calm-only copy).
          toast({
            title: "Failed to start lab",
            description: detail.includes(REMINT_FAIL_CODE) && detail === REMINT_FAIL_CODE
              ? REMINT_CALM_COPY
              : detail,
            variant: "destructive",
          });
          return;
        }
        if (cancelled) return;
        setReminting(false);
        setVmStatus("running");
        // P0c: refresh expires_at after remint reset on the server.
        try {
          const { data: refreshed } = await supabase
            .from("virtual_machines")
            .select("expires_at, lab_templates(duration, is_persistent)")
            .eq("id", vmId)
            .maybeSingle();
          if (refreshed && !cancelled) {
            const tpl = Array.isArray(refreshed.lab_templates)
              ? refreshed.lab_templates[0]
              : refreshed.lab_templates;
            setSession((prev) => ({
              ...prev,
              expiresAt: deriveExpiresAt({
                vmExpiresAt: refreshed.expires_at,
                durationMinutes: (tpl as { duration?: number } | null)?.duration,
                isPersistent: Boolean((tpl as { is_persistent?: boolean } | null)?.is_persistent),
              }),
            }));
          }
        } catch (e) {
          console.warn("[remint] expires_at refresh failed", e);
        }
      }
      if (!cancelled) await createGuacSession(vmId);
    })();
    return () => {
      cancelled = true;
    };
  }, [vmId, vmFactsLoaded, vmStatus, labTemplateId, createGuacSession]);

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

  // Countdown timer — wait for real expiresAt (never fake module-load 2h).
  useEffect(() => {
    if (!session.expiresAt) {
      setTimeRemaining("—");
      return;
    }
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
    if (reconnectAttemptsRef.current >= MAX_LEARNER_RECONNECTS) {
      setConnectionState("error");
      setIframeLoadFailed(true);
      setAwaitingDesktop(false);
      setLastError("secure_desktop_retry_exhausted");
      return;
    }
    const attempt = reconnectAttemptsRef.current;
    reconnectAttemptsRef.current = attempt + 1;
    setReconnectAttempts(attempt + 1);
    setConnectionState("connecting");
    setLastError(null);
    setIframeLoadFailed(false);
    try {
      // First soft retry: rotate scoped token. Later retries: remint create-session
      // (and reset idempotency) so we do not spin on a dead Guac connection.
      if (dbSessionId && vmId && attempt === 0) {
        const data = await fetchTokenizedGuacUrl(vmId, { action: "reconnect", sessionId: dbSessionId });
        applyGuacResult(data);
      } else if (vmId) {
        resetIdempotency(`guac-session:${vmId}`);
        setDbSessionId(null);
        await createGuacSession(vmId);
      } else {
        setLastError("This lab session is missing a VM. Go back to Labs and launch again.");
        setConnectionState("error");
      }
    } catch (err) {
      console.error("Reconnect failed:", err);
      setLastError(err instanceof Error ? err.message : "Reconnect failed");
      setConnectionState("error");
      setAwaitingDesktop(false);
    }
  };

  const handleClipboardSync = () => {
    toast({ title: "Clipboard synced", description: "Clipboard content sent to remote session." });
  };

  /** Apache Guacamole login/reconnect chrome stays covered and gets a fresh session. */
  const handleGuacChromeFailure = async () => {
    if (guacFailureInFlightRef.current) return;
    guacFailureInFlightRef.current = true;
    guacAttemptRef.current += 1;
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    if (desktopSettleRef.current) clearTimeout(desktopSettleRef.current);
    iframeRef.current?.removeAttribute("src");
    setAwaitingDesktop(true);
    setDesktopConfirmed(false);
    setConnectionState("connecting");
    const failedSessionId = dbSessionIdRef.current;
    dbSessionIdRef.current = null;
    setDbSessionId(null);
    setGuacIframeUrl("");
    if (vmId) {
      clearGuacReady(vmId);
      resetIdempotency(`guac-session:${vmId}`);
    }
    if (guacChromeRetryRef.current < MAX_GUAC_CHROME_RETRIES && vmId) {
      guacChromeRetryRef.current += 1;
      setIframeLoadFailed(false);
      setLastError(null);
      if (failedSessionId) {
        try {
          const { data, error } = await supabase.functions.invoke("guacamole-proxy", {
            body: { action: "end-session", session_id: failedSessionId, reason: "guac_chrome_hard_fail" },
          });
          if (error || data?.error) throw error ?? new Error(String(data.error));
        } catch (err) {
          console.error("Failed to clear unusable Guacamole session:", err);
          guacFailureInFlightRef.current = false;
          setAwaitingDesktop(false);
          setIframeLoadFailed(true);
          setConnectionState("error");
          setLastError("secure_desktop_login_wall");
          return;
        }
      }
      resetIdempotency(`guac-session:${vmId}`);
      guacFailureInFlightRef.current = false;
      await createGuacSession(vmId);
      return;
    }
    guacFailureInFlightRef.current = false;
    setAwaitingDesktop(false);
    setIframeLoadFailed(true);
    setConnectionState("error");
    setLastError("secure_desktop_login_wall");
  };

  /**
   * onLoad alone is NOT proof of a desktop: Guac error pages and the native
   * login wall fire it too. The gateway frame is cross-origin, so its DOM is
   * never read. The ONLY ready signal is the server tunnel check
   * (guacamole-proxy connection-health), which reports ready:true only while a
   * live remote connection exists for this session.
   */
  const handleIframeLoad = () => {
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    if (!isTokenizedGuacUrl(guacamoleUrl) || !/#\/client\//.test(guacamoleUrl)) {
      void handleGuacChromeFailure();
      return;
    }
    setIframeLoadFailed(false);
    setAwaitingDesktop(true);
    if (desktopSettleRef.current) clearTimeout(desktopSettleRef.current);
    const attempt = guacAttemptRef.current;
    const startedAt = Date.now();
    let cleanTicks = 0;

    const pollDesktop = async () => {
      if (attempt !== guacAttemptRef.current) return;
      if (!isTokenizedGuacUrl(guacamoleUrl) || !/#\/client\//.test(guacamoleUrl)) {
        void handleGuacChromeFailure();
        return;
      }

      let tunnelReady = false;
      try {
        tunnelReady = dbSessionIdRef.current ? await checkGuacSessionReady(dbSessionIdRef.current) : false;
      } catch {
        tunnelReady = false;
      }
      if (attempt !== guacAttemptRef.current) return;

      cleanTicks = tunnelReady ? cleanTicks + 1 : 0;
      if (cleanTicks >= GUAC_DESKTOP_CLEAN_TICKS) {
        setDesktopConfirmed(true);
        setConnectionState("connected");
        setAwaitingDesktop(false);
        guacChromeRetryRef.current = 0;
        return;
      }
      // Never ready within the window == login wall / dead tunnel: remint calmly.
      if (Date.now() - startedAt >= GUAC_DESKTOP_CONFIRM_TIMEOUT_MS) {
        void handleGuacChromeFailure();
        return;
      }
      desktopSettleRef.current = setTimeout(() => { void pollDesktop(); }, GUAC_DESKTOP_POLL_MS);
    };
    void pollDesktop();
  };

  /**
   * Even after a confirmed desktop the gateway tunnel can drop (session revoked,
   * auth failure, reconnect loop). The server check is authoritative: ready:false
   * is a HARD FAIL — hide the frame, drop the dead tokenized URL, remint calmly.
   */
  useEffect(() => {
    if (connectionState !== "connected") return;
    const timer = setInterval(async () => {
      const url = guacamoleUrl;
      if (!isTokenizedGuacUrl(url) || !/#\/client\//.test(url)) {
        void handleGuacChromeFailure();
        return;
      }
      try {
        const tunnelReady = dbSessionIdRef.current
          ? await checkGuacSessionReady(dbSessionIdRef.current)
          : false;
        if (!tunnelReady) void handleGuacChromeFailure();
      } catch {
        void handleGuacChromeFailure();
      }
    }, GUAC_CHROME_WATCH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState, guacamoleUrl]);




  const handleEndSession = async () => {
    // Leave = soft-stop: end the Guac/session (billable minutes deduct) + deallocate
    // the SAME VM. Never delete. Start later remints this allocation when wallet allows.
    if (!vmFactsLoaded && vmId) {
      const { data: vm } = await supabase
        .from("virtual_machines")
        .select("lab_templates(is_persistent)")
        .eq("id", vmId)
        .maybeSingle();
      const tpl = Array.isArray(vm?.lab_templates) ? vm?.lab_templates[0] : vm?.lab_templates;
      setIsPersistentLab(Boolean((tpl as { is_persistent?: boolean } | null)?.is_persistent));
    }

    if (dbSessionId) {
      try {
        await supabase.functions.invoke("guacamole-proxy", {
          body: { action: "end-session", session_id: dbSessionId },
        });
      } catch (err) {
        console.error("Failed to end session cleanly:", err);
      }
    }

    // Leaving must leave NOTHING behind that a return could reuse: the stashed
    // ready-URL, the old session id, the old iframe URL and the idempotency key
    // all die here. Next Connect mints a brand new tokenized session.
    if (vmId) {
      clearGuacReady(vmId);
      resetIdempotency(`guac-session:${vmId}`);
    }
    guacChromeRetryRef.current = 0;
    dbSessionIdRef.current = null;
    setDbSessionId(null);
    setGuacIframeUrl("");
    setDesktopConfirmed(false);
    setAwaitingDesktop(false);

    let walletNote = "Machine soft-stopped (not deleted). Start resumes the same lab when minutes remain.";
    if (vmId) {
      try {
        const { data } = await supabase.functions.invoke("cleanup-idle-labs", {
          body: { action: "learner-leave", vm_id: vmId, reason: "learner_leave" },
        });
        const w = data?.wallet as
          | { allocated_minutes?: number; used_minutes?: number; remaining_minutes?: number }
          | undefined;
        if (w && typeof w.remaining_minutes === "number" && typeof w.allocated_minutes === "number") {
          const used = typeof w.used_minutes === "number" ? w.used_minutes : w.allocated_minutes - w.remaining_minutes;
          walletNote = `${w.allocated_minutes} − ${used} = ${w.remaining_minutes} minutes remaining. Machine soft-stopped (not deleted).`;
        }
      } catch (err) {
        console.error("Failed to soft-stop lab on Leave:", err);
      }
    }
    toast({
      title: "Left the lab",
      description: walletNote,
    });
    navigate("/labs");
  };

  const connectionColor: Record<ConnectionState, string> = {
    connecting: "text-warning",
    connected: "text-success",
    disconnected: "text-muted-foreground",
    error: "text-destructive",
  };

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: reminting ? "Starting your lab machine…" : "Getting ready…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Needs attention",
  };

  const isTimeLow = (() => {
    if (!session.expiresAt) return false;
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
              {/* Operator barge-in marker: tokenized admin join, no learner password wall. */}
              {isSuperAdmin && searchParams.get("admin") === "1" && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    Admin barge-in
                  </span>
                </>
              )}
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
                  <div className="mr-1 flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
                    <Keyboard className={cn("h-3.5 w-3.5", keyboardHelper ? "text-primary" : "text-muted-foreground")} />
                    <Switch
                      id="lab-keyboard-helper"
                      checked={keyboardHelper}
                      onCheckedChange={(v) => {
                        keyboardHelperTouchedRef.current = true;
                        setKeyboardHelper(v);
                        if (v) setTypingArmed(false);
                      }}
                      className="scale-75 origin-left"
                    />
                    <Label htmlFor="lab-keyboard-helper" className="text-[10px] text-muted-foreground cursor-pointer">
                      Typing
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {keyboardHelper
                    ? "Typing goes into this lab for Ubuntu SSH and Windows RDP"
                    : "Turn on to type into this lab (SSH and RDP)"}
                </TooltipContent>
              </Tooltip>
              {labTemplateId && (
                <Sheet
                  onOpenChange={(open) => {
                    if (!open && keyboardHelper) focusGuacamoleFrame(iframeRef.current);
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      </SheetTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Keys &amp; folders</TooltipContent>
                  </Tooltip>
                  <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" {...{ [GUAC_KEEP_FOCUS_ATTR]: "" }}>
                    <SheetHeader>
                      <SheetTitle>Keys &amp; folders</SheetTitle>
                    </SheetHeader>
                    <LabWorkbenchPanel
                      labTemplateId={labTemplateId}
                      userId={user?.id}
                      dense
                      className="mt-4 border-none shadow-none"
                    />
                  </SheetContent>
                </Sheet>
              )}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className={isPersistentLab ? "h-8 w-8" : "h-8 w-8 text-destructive hover:text-destructive"}
                    onClick={handleEndSession}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isPersistentLab ? "Leave lab (soft-stop — Start resumes same VM)" : "Leave lab (soft-stop)"}
                </TooltipContent>
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
              role="status"
              aria-live="polite"
            >
              {reminting || waitingForLabPort || guacChromeRetryRef.current > 0 ? (
                <div className="mx-auto w-full max-w-md space-y-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-lg font-semibold text-foreground">
                      {reminting
                        ? "Starting your lab machine…"
                        : waitingForLabPort
                          ? "Almost ready — finishing start-up…"
                          : "Reconnecting securely…"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Please wait — your lab is being {reminting ? "started" : waitingForLabPort ? "prepared" : "reconnected"}.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/labs")}>Back to Labs</Button>
                </div>
              ) : (
                <LearnerProvisioningPanel
                  mode="preparing"
                  startedAt={connectStartedAt}
                  vmId={vmId}
                  onBack={() => navigate("/labs")}
                />
              )}
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
        {(connectionState === "connected" || (connectionState === "connecting" && !!guacamoleUrl)) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative h-full w-full"
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
                      errorMessage={
                        canDebug && showTechnicalTrace
                          ? `Failed to load session frame (attempt ${reconnectAttempts}/${MAX_LEARNER_RECONNECTS}): ${guacamoleUrl}`
                          : reconnectAttempts >= MAX_LEARNER_RECONNECTS
                            ? "secure_desktop_retry_exhausted"
                            : null
                      }
                      onRetry={
                        reconnectAttempts >= MAX_LEARNER_RECONNECTS
                          ? undefined
                          : () => { setIframeLoadFailed(false); handleReconnect(); }
                      }
                      onBack={() => navigate("/labs")}
                    />
                  </div>
                )}
                {(connectionState === "connecting" || awaitingDesktop) && !iframeLoadFailed && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-background px-6" role="status" aria-live="polite">
                    <div className="max-w-md text-center space-y-4">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                      <div className="space-y-1.5">
                        <h2 className="text-lg font-semibold text-foreground">
                          {reminting ? "Starting your lab machine…" : waitingForLabPort ? "Almost ready — finishing start-up…" : guacChromeRetryRef.current > 0 ? "Reconnecting securely…" : "Preparing your lab…"}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Please wait — your lab is being {reminting ? "started" : waitingForLabPort ? "prepared" : guacChromeRetryRef.current > 0 ? "reconnected" : "provisioned"}.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  // Fail closed: only a tokenized Guac client deep link may ever load.
                  // Chicken-and-egg: the frame MUST load (hidden, opacity-0, under the
                  // Hub cover) so Guac JS can open the tunnel that connection-health
                  // then observes. Never `display:none` / unmounted — that kills the
                  // tunnel and ready:true could never happen.
                  src={isTokenizedGuacUrl(guacamoleUrl) ? guacamoleUrl : undefined}
                  className={cn(
                    "h-full w-full border-0 transition-opacity duration-200",
                    connectionState === "connected" && desktopConfirmed && !awaitingDesktop ? "opacity-100" : "pointer-events-none opacity-0"
                  )}
                  aria-hidden={connectionState !== "connected" || !desktopConfirmed || awaitingDesktop}
                  tabIndex={connectionState === "connected" && desktopConfirmed && !awaitingDesktop ? 0 : -1}
                  style={{ objectFit: "contain" }}
                  allow={GUAC_IFRAME_ALLOW}
                  title="Lab Session"
                  onLoad={handleIframeLoad}
                  onError={() => {
                    setIframeLoadFailed(true);
                    setAwaitingDesktop(false);
                    setConnectionState("error");
                    setLastError("secure_desktop_frame_error");
                  }}
                />
                {showTypingGate({
                  typingAssist: keyboardHelper,
                  connected: connectionState === "connected",
                  desktopConfirmed,
                  awaitingDesktop,
                  armed: typingArmed,
                  hasSessionUrl: Boolean(guacamoleUrl),
                }) && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Click once to type into this lab"
                    className="absolute inset-0 z-20 flex items-end justify-center bg-transparent pb-8 outline-none"
                    onPointerDown={(e) => {
                      // Focus during the gesture, then keep this hint from taking focus.
                      setTypingArmed(true);
                      focusGuacamoleFrame(iframeRef.current);
                      e.preventDefault();
                    }}
                    onKeyDown={(e) => {
                      setTypingArmed(true);
                      focusGuacamoleFrame(iframeRef.current);
                      e.preventDefault();
                    }}
                  >
                    <span className="pointer-events-none rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-sm">
                      Click once, then type into this lab
                    </span>
                  </div>
                )}
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
      {showToolbar && (connectionState === "connected" || (connectionState === "connecting" && !!guacamoleUrl)) && (
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
