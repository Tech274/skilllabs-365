/**
 * Guacamole Connect gate helpers.
 * Learners must never be handed a bare Guacamole URL (native login wall).
 * Only tokenized iframe URLs from guacamole-proxy are allowed.
 */

import { supabase } from "@/integrations/supabase/client";
import { idempotencyHeaders } from "@/lib/idempotency";
import { readFunctionError } from "@/lib/function-error";


/** Rewrite private/http Guac API hosts to the public HTTPS gateway for iframes. */
export function toBrowserSafeGuacUrl(url: string): string {
  const PUBLIC = "https://guac.skillhub365.co.in";
  try {
    const u = new URL(url);
    const isPrivate =
      u.protocol === "http:" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) ||
      u.port === "8080";
    if (!isPrivate && u.protocol === "https:") return url;
    const path = u.pathname.replace(/\/+$/, "") || "";
    const guacPath = path.endsWith("/guacamole") || path.includes("/guacamole")
      ? path
      : path
        ? `${path}/guacamole`
        : "/guacamole";
    const hash = u.hash || "";
    const search = u.search || "";
    // Prefer hash token form: #/client/...?token=
    return `${PUBLIC}${guacPath}${hash}${search}`;
  } catch {
    return url;
  }
}

/** True when URL carries a Guacamole auth token (query or hash). */
export function isTokenizedGuacUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  // Token may sit in query (?token=) or after hash (#/client/...?token=)
  return /[?&#]token=[^&]+/.test(trimmed) && /#\/client\//.test(trimmed);
}

export type GuacConnectResult = {
  iframe_url: string;
  session_id?: string;
  protocol?: string;
  vm_ip?: string;
  region?: string | null;
};

const LEARNER_HOLD =
  "We're finishing a few last checks on your lab. Please hold — this is usually temporary.";

export function learnerConnectHoldCopy(raw?: string | null): string {
  if (!raw) return LEARNER_HOLD;
  // Never surface Guac / Azure / RDP / SSH / provider strings to learners
  if (
    /guacamole|token|rdp|ssh|azure|arm|nsg|timeout|401|403|500|ECONN|refused|password|auth/i.test(
      raw,
    )
  ) {
    return "We're hitting a small technical glitch while connecting your lab — we're on it. Please hold and try again in a moment.";
  }
  if (raw.length > 160) return LEARNER_HOLD;
  return raw;
}

/** Invoke guacamole-proxy and require a tokenized iframe_url. */
export async function fetchTokenizedGuacUrl(
  vmId: string,
  opts?: { action?: "create-session" | "reconnect"; sessionId?: string },
): Promise<GuacConnectResult> {
  const action = opts?.action ?? "create-session";
  const body =
    action === "reconnect" && opts?.sessionId
      ? { action: "reconnect", session_id: opts.sessionId }
      : { action: "create-session", vm_id: vmId };

  const { data, error } = await supabase.functions.invoke("guacamole-proxy", {
    body,
    headers: idempotencyHeaders(`guac-session:${vmId}`),
  });

  if (error || data?.error) {
    throw new Error(await readFunctionError(error, data));
  }

  const iframeUrl = data?.iframe_url
    ? toBrowserSafeGuacUrl(String(data.iframe_url))
    : undefined;
  if (!isTokenizedGuacUrl(iframeUrl)) {
    throw new Error(
      "Secure lab desktop is not ready yet (missing connection token). Please hold and try again.",
    );
  }

  return {
    iframe_url: iframeUrl!,
    session_id: data.session_id,
    protocol: data.protocol,
    vm_ip: data.vm_ip,
    region: data.region ?? null,
  };
}

export type ReadyGateOptions = {
  vmId: string;
  /** Max wait for Hub running + tokenized Guac (default 120s). */
  timeoutMs?: number;
  pollMs?: number;
  onTick?: (info: { elapsedMs: number; phase: string }) => void;
};

/**
 * Poll until Hub VM status is `running`, then obtain a tokenized Guacamole iframe URL.
 * Does not navigate — callers hand off only after this resolves.
 */
export async function waitForRunningAndTokenizedGuac(
  opts: ReadyGateOptions,
): Promise<GuacConnectResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 4_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const elapsedMs = Date.now() - started;
    opts.onTick?.({ elapsedMs, phase: "checking-lab" });

    const { data: statusData } = await supabase.functions.invoke("check-vm-status", {
      body: { vm_id: opts.vmId },
    });
    const status = String(statusData?.status ?? "").toLowerCase();

    if (status === "failed" || status === "terminated" || status === "deallocated") {
      throw new Error(`Lab entered ${status} state before connect was ready.`);
    }

    if (status === "running") {
      opts.onTick?.({ elapsedMs, phase: "securing-desktop" });
      try {
        return await fetchTokenizedGuacUrl(opts.vmId);
      } catch (err) {
        // Token not ready yet — keep polling within timeout
        opts.onTick?.({
          elapsedMs,
          phase: "waiting-secure-desktop",
        });
        console.warn("[guac-connect] token not ready yet:", err);
      }
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    "Lab is taking longer than expected to finish secure connect. Please hold and try again shortly.",
  );
}

const STASH_PREFIX = "skillhub:guac-ready:";

export function stashGuacReady(vmId: string, payload: GuacConnectResult): void {
  try {
    sessionStorage.setItem(
      `${STASH_PREFIX}${vmId}`,
      JSON.stringify({ ...payload, stashed_at: Date.now() }),
    );
  } catch {
    // sessionStorage may be unavailable
  }
}

export function takeGuacReady(vmId: string): GuacConnectResult | null {
  try {
    const raw = sessionStorage.getItem(`${STASH_PREFIX}${vmId}`);
    if (!raw) return null;
    sessionStorage.removeItem(`${STASH_PREFIX}${vmId}`);
    const parsed = JSON.parse(raw) as GuacConnectResult & { stashed_at?: number };
    if (!isTokenizedGuacUrl(parsed.iframe_url)) return null;
    // Ignore stashes older than 10 minutes
    if (parsed.stashed_at && Date.now() - parsed.stashed_at > 10 * 60_000) return null;
    return {
      iframe_url: parsed.iframe_url,
      session_id: parsed.session_id,
      protocol: parsed.protocol,
      vm_ip: parsed.vm_ip,
      region: parsed.region ?? null,
    };
  } catch {
    return null;
  }
}
