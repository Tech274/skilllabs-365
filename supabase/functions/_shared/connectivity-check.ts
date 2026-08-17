// Optional post-provisioning connectivity probe.
//
// Lab VMs only carry private IPs, so this is a best-effort TCP reachability
// check from the edge runtime: it confirms the RDP/SSH port answers when the
// network path allows it, and records the outcome on the provisioning audit
// timeline either way (success / failed / skipped — never fatal).

export interface ConnectivityResult {
  attempted: boolean;
  reachable: boolean;
  protocol: "rdp" | "ssh";
  port: number;
  host: string | null;
  latency_ms: number | null;
  error?: string;
}

export function protocolForImage(osImage: string): { protocol: "rdp" | "ssh"; port: number } {
  return osImage.toLowerCase().includes("windows")
    ? { protocol: "rdp", port: 3389 }
    : { protocol: "ssh", port: 22 };
}

/** TCP connect with a hard timeout. Never throws. */
export async function checkConnectivity(
  host: string | null | undefined,
  osImage: string,
  timeoutMs = 5000,
): Promise<ConnectivityResult> {
  const { protocol, port } = protocolForImage(osImage);
  const base: ConnectivityResult = {
    attempted: false, reachable: false, protocol, port,
    host: host ?? null, latency_ms: null,
  };

  if (!host || host === "pending") {
    return { ...base, error: "No private IP assigned yet" };
  }

  const started = Date.now();
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname: host, port, transport: "tcp" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    try { conn.close(); } catch { /* already closed */ }
    return { ...base, attempted: true, reachable: true, latency_ms: Date.now() - started };
  } catch (e) {
    return {
      ...base,
      attempted: true,
      reachable: false,
      latency_ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
