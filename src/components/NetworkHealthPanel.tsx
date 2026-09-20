import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Health = "green" | "amber" | "red";

interface HealthCheck {
  id: string;
  label: string;
  url: string;
  status: Health;
  httpStatus: number | null;
  tlsValid: boolean;
  latencyMs: number;
  reason: string;
}

interface HealthResponse {
  overall: Health;
  checked_at: string;
  checks: HealthCheck[];
}

/** Probes go stale after 5 minutes — a stale reading is shown as Amber, never Green. */
const STALE_AFTER_MS = 5 * 60 * 1000;
const POLL_MS = 60 * 1000;

/** Format an ISO timestamp in IST (Asia/Kolkata). */
export function formatIST(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })} IST`;
}

const BADGE: Record<Health, { label: string; className: string; dot: string }> = {
  green: {
    label: "GREEN",
    className: "border-success/40 bg-success/10 text-success",
    dot: "bg-success",
  },
  amber: {
    label: "AMBER",
    className: "border-warning/40 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  red: {
    label: "RED",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

function HealthBadge({ status }: { status: Health }) {
  const b = BADGE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider",
        b.className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
      {b.label}
    </span>
  );
}

export function NetworkHealthPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error: err } = await supabase.functions.invoke("network-health");
    if (err) {
      setError(err.message || "Health probe could not run");
    } else {
      setError(null);
      setData(res as HealthResponse);
    }
    setNow(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const checkedAt = data?.checked_at ?? null;
  const isStale = checkedAt ? now - new Date(checkedAt).getTime() > STALE_AFTER_MS : false;

  // Stale readings degrade to Amber; a Red reading always stays Red.
  const effective = (status: Health): Health =>
    status === "red" ? "red" : isStale ? "amber" : status;

  const overall: Health = error ? "amber" : data ? effective(data.overall) : "amber";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Network Health</h3>
          <HealthBadge status={overall} />
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground font-mono">
            Last check: {formatIST(checkedAt)}
            {isStale ? " · stale" : ""}
          </span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-3 w-3 mr-1.5", loading && "animate-spin")} />
            Re-check
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <ShieldAlert className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
          <p className="text-xs text-warning">Probe did not run: {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(data?.checks ?? []).map((c) => {
          const status = effective(c.status);
          return (
            <div
              key={c.id}
              className={cn(
                "rounded-lg border p-3 space-y-2",
                status === "red"
                  ? "border-destructive/40 bg-destructive/5"
                  : status === "amber"
                    ? "border-warning/30 bg-warning/5"
                    : "border-border/50 bg-muted/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{c.label}</span>
                <HealthBadge status={status} />
              </div>
              <p className="text-[10px] font-mono text-muted-foreground break-all">{c.url}</p>
              <p
                className={cn(
                  "text-[11px]",
                  status === "red"
                    ? "text-destructive"
                    : status === "amber"
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                {isStale && c.status !== "red" ? `Stale reading — ${c.reason}` : c.reason}
              </p>
            </div>
          );
        })}
        {!data && !loading && !error && (
          <p className="text-xs text-muted-foreground">No health data yet.</p>
        )}
      </div>
    </motion.div>
  );
}
