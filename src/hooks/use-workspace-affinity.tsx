import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { rankRecentWorkspaces } from "@/lib/workspace-launches";

export function useWorkspaceAffinity() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentOrder, setRecentOrder] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setFavorites(new Set());
      setRecentOrder([]);
      return;
    }
    const [favs, events] = await Promise.all([
      supabase.from("workspace_favorites").select("workspace_id").eq("user_id", user.id),
      supabase
        .from("platform_application_launch_events")
        .select("workspace_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setFavorites(new Set((favs.data ?? []).map((f) => f.workspace_id)));
    setRecentOrder(rankRecentWorkspaces(events.data ?? []));
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const toggleFavorite = useCallback(async (workspaceId: string) => {
    if (!user) return;
    const isFav = favorites.has(workspaceId);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(workspaceId); else next.add(workspaceId);
      return next;
    });
    if (isFav) {
      await supabase.from("workspace_favorites").delete()
        .eq("user_id", user.id).eq("workspace_id", workspaceId);
    } else {
      await supabase.from("workspace_favorites")
        .insert({ user_id: user.id, workspace_id: workspaceId });
    }
  }, [favorites, user]);

  return { favorites, recentOrder, toggleFavorite, refresh: load };
}
