import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

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

    pollRef.current = setInterval(async () => {
      try {
        const { data: statusData } = await supabase.functions.invoke("check-vm-status", {
          body: { vm_id: vmId },
        });
        const vmStatus = statusData?.status;
        if (vmStatus === "running") {
          clearProvisioning();
          toast({ title: "✅ VM Ready", description: `${labName} is ready to use.` });
          sendBrowserNotification("Lab Ready", `${labName} is ready to use.`);
          playReadyChime();
          navigate(`/labs/session/${labId}?vm_id=${vmId}`);
        } else if (vmStatus === "failed" || vmStatus === "terminated" || vmStatus === "deallocated") {
          clearProvisioning();
          toast({ title: "Launch Failed", description: `VM entered ${vmStatus} state.`, variant: "destructive" });
          sendBrowserNotification("Lab Launch Failed", `${labName} failed to provision.`);
        }
      } catch {
        // Ignore poll errors
      }
    }, 10000);

    timeoutRef.current = setTimeout(() => {
      clearProvisioning();
      toast({ title: "Provisioning Timeout", description: "VM took too long. Please try again.", variant: "destructive" });
    }, 180000);
  }, [clearProvisioning, navigate]);

  const cancelProvisioning = useCallback(async () => {
    if (!state.vmId) return;
    setState((prev) => ({ ...prev, cancelling: true }));
    try {
      await supabase.functions.invoke("cleanup-idle-labs", {
        body: { action: "deallocate-vm", vm_id: state.vmId },
      });
      toast({ title: "Provisioning Cancelled", description: "VM has been deallocated." });
    } catch {
      toast({ title: "Cancel Failed", description: "Could not cancel VM.", variant: "destructive" });
    }
    clearProvisioning();
  }, [state.vmId, clearProvisioning]);

  return (
    <ProvisioningContext.Provider value={{ ...state, startProvisioning, cancelProvisioning, clearProvisioning }}>
      {children}
    </ProvisioningContext.Provider>
  );
}

export function useProvisioning() {
  const ctx = useContext(ProvisioningContext);
  if (!ctx) throw new Error("useProvisioning must be used within ProvisioningProvider");
  return ctx;
}
