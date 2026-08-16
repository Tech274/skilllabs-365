import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";

type DeliveryRow = {
  id: string;
  alert_title: string;
  alert_status: string;
  channel: string;
  delivery_status: string;
  recipients: number;
  detail: string | null;
  created_at: string;
};

const STATUS_CLASS: Record<string, string> = {
  sent: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  deduplicated: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
};

export function AiAlertDeliveries() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_alert_deliveries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data ?? []) as DeliveryRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Alert delivery log</CardTitle>
            <CardDescription>
              In-app and webhook alert attempts with success, failure or dedupe outcome.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title="No alerts delivered yet"
            description="Delivery attempts are recorded whenever an AI outage alert fires."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">{r.alert_title}</TableCell>
                    <TableCell className="text-xs">
                      {r.channel === "in_app" ? "In-app" : "Webhook"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASS[r.delivery_status] ?? ""}>
                        {r.delivery_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.recipients}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {r.detail ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
