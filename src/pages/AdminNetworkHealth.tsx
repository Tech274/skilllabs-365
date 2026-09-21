import { DashboardLayout } from "@/components/DashboardLayout";
import { NetworkHealthPanel } from "@/components/NetworkHealthPanel";

export default function AdminNetworkHealth() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Host & TLS checks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gateway host OK (not Connect) — server-side HTTPS probes (15s timeout, TLS
            verified) of Hub and both Guacamole landing pages. Does not verify lab
            desktop tunnels or session path. Re-checks automatically every 60 seconds.
          </p>
        </div>
        <NetworkHealthPanel />
      </div>
    </DashboardLayout>
  );
}
