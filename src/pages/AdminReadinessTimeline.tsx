import { DashboardLayout } from "@/components/DashboardLayout";
import { History } from "lucide-react";

/** Tip 9de17a0a surface — full body synced in follow-up commits on this branch. */
export default function AdminReadinessTimeline() {
  return (
    <DashboardLayout>
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <History className="h-6 w-6 text-primary" /> Readiness timeline
        </h1>
        <p className="text-sm text-muted-foreground">
          Frontend tip surface placeholder — replace with tip 9de17a0a page body.
        </p>
      </div>
    </DashboardLayout>
  );
}
