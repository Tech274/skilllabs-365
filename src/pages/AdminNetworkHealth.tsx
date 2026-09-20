import { DashboardLayout } from "@/components/DashboardLayout";
import { NetworkHealthPanel } from "@/components/NetworkHealthPanel";

export default function AdminNetworkHealth() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Network Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Server-side HTTPS probes (15s timeout, TLS verified) of the Hub and both Guacamole gateways.
            Re-checks automatically every 60 seconds.
          </p>
        </div>
        <NetworkHealthPanel />
      </div>
    </DashboardLayout>
  );
}
