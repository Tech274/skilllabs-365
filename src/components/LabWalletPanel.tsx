import { CalendarRange, Clock, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMinutes, walletEquation, type LabWallet } from "@/lib/lab-wallet";

/**
 * Learner-facing lab wallet: allocated − used = remaining.
 * Non-persistent labs are minutes-primary; persistent labs also show the
 * start/end window. Minutes are consumed by session usage, not by a grant.
 */
export function LabWalletPanel({ wallet, className }: { wallet: LabWallet; className?: string }) {
  const low = !wallet.exhausted && wallet.allocatedMinutes > 0 && wallet.remainingMinutes <= Math.max(wallet.allocatedMinutes * 0.1, 5);

  return (
    <div className={cn("rounded-lg border border-border/70 bg-muted/30 p-3 space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Wallet className="h-3 w-3" /> Lab wallet
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            wallet.exhausted ? "text-destructive" : low ? "text-warning" : "text-foreground",
          )}
        >
          {formatMinutes(wallet.remainingMinutes)} left
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70">
        <div
          className={cn("h-full rounded-full", wallet.exhausted ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.round(wallet.percentUsed)}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="font-mono text-xs font-semibold text-foreground">{formatMinutes(wallet.allocatedMinutes)}</p>
          <p className="text-[9px] uppercase text-muted-foreground">Allocated</p>
        </div>
        <div>
          <p className="font-mono text-xs font-semibold text-foreground">{formatMinutes(wallet.usedMinutes)}</p>
          <p className="text-[9px] uppercase text-muted-foreground">Used</p>
        </div>
        <div>
          <p className="font-mono text-xs font-semibold text-foreground">{formatMinutes(wallet.remainingMinutes)}</p>
          <p className="text-[9px] uppercase text-muted-foreground">Remaining</p>
        </div>
      </div>

      {wallet.isPersistent && (wallet.startLabel || wallet.endLabel) && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarRange className="h-3 w-3" />
          {wallet.startLabel ?? "—"} → {wallet.endLabel ?? "—"} (IST)
        </p>
      )}

      <p className="text-[10px] font-mono text-muted-foreground text-center">
        {walletEquation(wallet)} min
      </p>

      {(wallet.exhausted || wallet.windowEnded) && (
        <p className="flex items-center gap-1.5 text-[11px] text-destructive">
          <Clock className="h-3 w-3" />
          {wallet.exhausted ? "Minutes used up" : "Lab window ended"} — Start is blocked. Machine is held (not deleted).
        </p>
      )}
    </div>
  );
}
