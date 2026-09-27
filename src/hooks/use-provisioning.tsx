import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { readFunctionError, readFunctionErrorPayload } from "@/lib/function-error";
import { useNavigate } from "react-router-dom";
import { idempotencyHeaders, resetIdempotency } from "@/lib/idempotency";
import {
  learnerConnectHoldCopy,
  stashGuacReady,
  waitForRunningAndTokenizedGuac,
} from "@/lib/guac-connect";
import { cancelToastCopy, parseCancelResponse, type CancelOutcome } from "@/lib/cancel-outcome";

interface ProvisioningState {
  isProvisioning: boolean;
  labId: string | null;
  labName: string | null;
  vmId: string | null;
  startedAt: number | null;
  cancelling: boolean;
}

interface ProvisioningContextType extends ProvisioningState {
  startProvisioning: (labId: string, labName: string, vmId: string) => void;
  cancelProvisioning: () => Promise<void>;
  clearProvisioning: () => void;
  /** Result of the most recent Cancel (SCRUM-106: kept vs removed). */
  lastCancel: CancelOutcome | null;
}

const ProvisioningContext = createContext<ProvisioningContextType | null>(null);

function sendBrowserNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        new Notification(title, { body, icon: "/favicon.ico" });
      }
    });
  }
}

function playReadyChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 chord arpeggio
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.5);
    });
  } catch {
    // Audio not available
  }
}

function playFailChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio not available
  }
}

export function ProvisioningProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<ProvisioningState>({
    isProvisioning: false,
    labId: null,
    labName: null,
    vmId: null,
    startedAt: null,
    cancelling: false,
  });
  const [lastCancel, setLastCancel] = useState<CancelOutcome | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProvisioning = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
    setState({
      isProvisioning: false,
      labId: null,
      labName: null,
      vmId: null,
      startedAt: null,
      cancelling: false,
    });
  }, []);

  const startProvisioning = useCallback((labId: string, labName: string, vmId: string) => {
    // Request notification permission early
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    setState({
      isProvisioning: true,
      labId,
      labName,
      vmId,
      startedAt: Date.now(),
      cancelling: false,
    });

    // Gate: stay on calm panel until Hub running AND guacamole-proxy returns a tokenized URL.
    // Do not navigate to /labs/session early (avoids Guacamole native login wall).
    (async () => {
      try {
        const guac = await waitForRunningAndTokenizedGuac({
          vmId,
          timeoutMs: 120_000,
          pollMs: 4_000,
        });
        stashGuacReady(vmId, guac);
        clearProvisioning();
        toast({ title: "Lab ready", description: `${labName} is ready — opening your secure desktop.` });
        sendBrowserNotification("Lab Ready", `${labName} is ready to use.`);
        playReadyChime();
        navigate(`/labs/session/${labId}?vm_id=${vmId}`);
      } catch (err) {
        clearProvisioning();
        const masked = learnerConnectHoldCopy(err instanceof Error ? err.message : null);
        toast({ title: "Still getting ready", description: masked, variant: "destructive" });
        sendBrowserNotification("Lab not ready yet", masked);
        playFailChime();
      }
    })();
  }, [clearProvisioning, navigate]);

  const cancelProvisioning = useCallback(async () => {
    if (!state.vmId) return;
    setState((prev) => ({ ...prev, cancelling: true }));
    try {
      const { data, error } = await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "cancel-provisioning", vm_id: state.vmId },
        headers: idempotencyHeaders(`cancel:${state.vmId}`),
      });
      if (error || data?.error) {
        const msg = await readFunctionError(error, data);
        const code = (data as { code?: string } | null)?.code
          ?? (error ? (await readFunctionErrorPayload(error))?.code : undefined);
        throw new Error(code && !msg.includes(String(code)) ? `${code}: ${msg}` : msg);
      }
      const outcome = parseCancelResponse(state.vmId, state.labId, data);
      setLastCancel(outcome);
      toast(cancelToastCopy(outcome));
      if (state.labId) resetIdempotency(`provision:${state.labId}`);
    } catch (err) {
      toast({
        title: "Cancel Failed",
        description: err instanceof Error ? err.message : "Could not cancel VM.",
        variant: "destructive",
      });
    }
    resetIdempotency(`cancel:${state.vmId}`);
    clearProvisioning();
  }, [state.vmId, state.labId, clearProvisioning]);

  return (
    <ProvisioningContext.Provider value={{ ...state, startProvisioning, cancelProvisioning, clearProvisioning, lastCancel }}>
      {children}
    </ProvisioningContext.Provider>
  );
}

export function useProvisioning() {
  const ctx = useContext(ProvisioningContext);
  if (!ctx) throw new Error("useProvisioning must be used within ProvisioningProvider");
  return ctx;
}
