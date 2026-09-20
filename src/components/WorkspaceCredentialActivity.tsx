import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EVENT_LABELS, type CredentialEventType } from "@/lib/workspace-credentials";

interface ActivityRow {
  id: string;
  created_at: string;
  workspace_name: string;
  event_type: string;
  detail: Record<string, unknown> | null;
}

const TONE: Record<string, string> = {
  issued: "border-primary/30 text-primary",
  regenerated: "border-primary/30 text-primary",
  copied: "border-border text-muted-foreground",
  opened: "border-success/30 text-success",
  expired: "border-destructive/30 text-destructive",
};

export function WorkspaceCredentialActivity({ workspaceId, limit = 20 }: {
  workspaceId?: string;
  limit?: number;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setRows([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("workspace_credential_events")
      .select("id, created_at, workspace_name, event_type, detail")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data } = await query;
    setRows((data ?? []) as ActivityRow[]);
    setLoading(false);
  }, [user, workspaceId, limit]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Credential activity</h2>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void load()}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading activity…" : "No credential activity recorded yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <Badge variant="outline" className={TONE[r.event_type] ?? ""}>
                {EVENT_LABELS[r.event_type as CredentialEventType] ?? r.event_type}
              </Badge>
              <span className="truncate font-medium text-foreground">{r.workspace_name}</span>
              {typeof r.detail?.field === "string" && (
                <span className="text-muted-foreground truncate">{r.detail.field as string}</span>
              )}
              <span className="ml-auto shrink-0 text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
