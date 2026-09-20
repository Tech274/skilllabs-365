/**
 * Guacamole Connect gate helpers.
 * Learners must never be handed a bare Guacamole URL (native login wall).
 * Only tokenized iframe URLs from guacamole-proxy are allowed.
 *
 * Dual-Guac: proxy picks the public host by VM cloud provider. Frontend
 * trusts known public hosts from the proxy response; private/http URLs are
 * rewritten using the provider map (aws → guac.skillhub365.co.in,
 * azure → guac-azure.skillhub365.co.in).
 */

import { supabase } from "@/integrations/supabase/client";
import { idempotencyHeaders } from "@/lib/idempotency";
import { readFunctionError, readFunctionErrorPayload, formatFunctionError } from "@/lib/function-error";
import {
  KNOWN_GUAC_PUBLIC_HOSTS,
  normalizeGuacCloudProvider,
  publicGuacBaseForProvider,
  type GuacCloudProvider,
} from "@/lib/guac-public-hosts";

export type { GuacCloudProvider };

/** Rewrite private/http Guac API hosts to the provider's public HTTPS gateway. */
export function toBrowserSafeGuacUrl(
  url: string,
  provider?: GuacCloudProvider | string | null,
): string {
  const PUBLIC = publicGuacBaseForProvider(provider);
  try {
    const u = new URL(url);
    // Proxy already returned a known public HTTPS host — trust it.
    if (u.protocol === "https:" && KNOWN_GUAC_PUBLIC_HOSTS.has(u.hostname)) {
      return url;
    }
    const isPrivate =
      u.protocol === "http:" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) ||
      u.port === "8080";
    if (!isPrivate && u.protocol === "https:") return url;
    let path = (u.pathname || "").replace(/\/+$/, "");
    if (!path.endsWith("/guacamole") && !path.includes("/guacamole")) {
      path = path ? `${path}/guacamole` : "/guacamole";
    }
    // Guac client URLs use /guacamole/#/client/...
    if (!path.endsWith("/")) path = `${path}/`;
    return `${PUBLIC}${path}${u.hash || ""}${u.search || ""}`;
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

/** Native Guacamole chrome is never a confirmed learner desktop. */
export const GUAC_HARD_FAIL_COPY =
  /log\s*in\s*failed|too\s*many\s*failed\s*authentication|authentication\s*attempts|invalid\s*login|access\s*denied|reconnecting|unreachable|username|password|apache\s*guacamole/i;

export const GUAC_LOGIN_CHROME_SELECTOR = [
  'input[type="password"]',
  'input[name="username"]',
  'input[name="password"]',
  'form.login-form',
  '.login-ui',
  '.login-dialog',
].join(",");

export type GuacDocumentReadiness = {
  hardFail: boolean;
  positiveDesktop: boolean;
};

/**
 * Inspect a same-origin Guacamole document when browser policy permits it.
 * Cross-origin callers catch the access error and use the server tunnel gate.
 */
export function inspectGuacDocument(doc: Document): GuacDocumentReadiness {
  const body = doc.body;
  if (!body) return { hardFail: false, positiveDesktop: false };
  const text = body.innerText || body.textContent || "";
  const loginControl = body.querySelector(GUAC_LOGIN_CHROME_SELECTOR);
  const loneLoginButton = Array.from(body.querySelectorAll("button, input[type='submit']")).some((node) => {
    const label = node instanceof HTMLInputElement ? node.value : node.textContent;
    return /^\s*log\s*in\s*$/i.test(label || "");
  });
  const canvas = body.querySelector("canvas");
  const display = body.querySelector(".display, .client-view, .remote-desktop, .guac-display");
  return {
    hardFail: Boolean(loginControl || loneLoginButton || GUAC_HARD_FAIL_COPY.test(text)),
    positiveDesktop: Boolean(canvas || display),
  };
}

/** Gateway refused to mint a desktop because the lab port is not answering yet. */
export const LAB_PORT_UNREACHABLE_CODES = ["rdp_unreachable", "ssh_unreachable"] as const;

export class LabPortUnreachableError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LabPortUnreachableError";
    this.code = code;
  }
}

export function isLabPortUnreachable(err: unknown): err is LabPortUnreachableError {
  return err instanceof LabPortUnreachableError;
}

export type GuacConnectResult = {
  iframe_url: string;
  session_id?: string;
  protocol?: string;
  vm_ip?: string;
  region?: string | null;
  cloud_provider?: GuacCloudProvider;
  /** Connection health proof from the gateway probe (no secrets). */
  health?: {
    /** "edge_ok" | "edge_skipped" | "edge_skipped_or_timeout" — advisory only. */
    probe?: string;
    reachable: boolean | null;
    host: string;
    port: number;
    latency_ms: number | null;
  };
};

/** Confirm that Guacamole has a live remote tunnel before revealing its frame. */
export async function checkGuacSessionReady(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("guacamole-proxy", {
    body: { action: "connection-health", session_id: sessionId },
  });
  if (error || data?.error) {
    throw new Error(await readFunctionError(error, data));
  }
  return data?.ready === true;
}

const LEARNER_HOLD =
  "We're finishing a few last checks on your lab. Please hold — this is usually temporary.";

export function learnerConnectHoldCopy(raw?: string | null): string {
  if (!raw) return LEARNER_HOLD;
  // Wallet / Start-gate messages are intentional learner copy — keep them.
  if (/lab minutes used up|date window has ended|start is blocked|minutes are granted/i.test(raw)) {
    return raw.length > 280 ? raw.slice(0, 277) + "…" : raw;
  }
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
    const payload = await readFunctionErrorPayload(error, data);
    const code = String(payload?.code ?? "");
    if ((LAB_PORT_UNREACHABLE_CODES as readonly string[]).includes(code)) {
      throw new LabPortUnreachableError(
        payload?.error ??
          "Your lab machine is still finishing start-up. Please hold — we will keep trying.",
        code,
      );
    }
    throw new Error(formatFunctionError(payload, error));
  }

  const cloudProvider = data?.cloud_provider
    ? normalizeGuacCloudProvider(data.cloud_provider)
    : undefined;

  const iframeUrl = data?.iframe_url
    ? toBrowserSafeGuacUrl(String(data.iframe_url), cloudProvider)
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
    cloud_provider: cloudProvider,
    health: data.health ?? undefined,
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

    // deallocated/stopped/starting are NOT fatal: callers remint (start the same
    // allocation) first and then wait here for `running`.
    if (status === "failed" || status === "terminated") {
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

/**
 * Drop any stashed ready-URL for this VM without returning it.
 * Used on Leave and on hard-fail: a stashed URL points at a torn-down
 * Guacamole connection, which would land the learner on the login wall.
 */
export function clearGuacReady(vmId: string): void {
  try {
    sessionStorage.removeItem(`${STASH_PREFIX}${vmId}`);
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
      cloud_provider: parsed.cloud_provider,
    };
  } catch {
    return null;
  }
}
