import { useCallback, useEffect, useMemo, useState } from "react";
import { AppWindow, ChevronLeft, ChevronRight, Search, Star } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  useWorkspaceEmailDomain, useWorkspaceLauncher, WorkspaceTile, type Workspace,
} from "@/components/WorkspaceLauncher";
import { WorkspaceCredentialActivity } from "@/components/WorkspaceCredentialActivity";
import { useWorkspaceAffinity } from "@/hooks/use-workspace-affinity";
import { orderByAffinity } from "@/lib/workspace-launches";
import { WORKSPACE_CATEGORIES } from "@/lib/workspaces";
import { filterAssignedWorkspaces, scopeToAssignments } from "@/lib/assigned-workspaces";

const PAGE_SIZE = 24;
/** Caps the fuzzy RPC used only to rank/filter an already assignment-scoped set. */
const SEARCH_CAP = 500;

export default function Applications() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [page, setPage] = useState(0);
  const domain = useWorkspaceEmailDomain();
  const { open, dialog } = useWorkspaceLauncher(domain);
  const { favorites, recentOrder, toggleFavorite, refresh } = useWorkspaceAffinity();

  // Debounce typing so fuzzy search does not fire on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setTerm(search); setPage(0); }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setWorkspaces([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Source of truth is this learner's active assignments, not the catalog RPC.
    // search_workspaces is SECURITY INVOKER and returns every active row the
    // caller can read — platform admins can read the whole catalog.
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from("workspace_assignments")
      .select("workspace_id, platform_applications(*)")
      .eq("user_id", userId)
      .is("revoked_at", null);

    if (assignmentError) {
      setWorkspaces([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const assignmentIds = (assignmentRows ?? []).map((row) => row.workspace_id);
    const embedded = (assignmentRows ?? [])
      .map((row) => row.platform_applications)
      .filter((workspace): workspace is Workspace => Boolean(workspace) && !Array.isArray(workspace));
    let scoped = scopeToAssignments(embedded, assignmentIds);

    const searching = Boolean(term.trim()) || category !== "All";
    if (searching && scoped.length > 0) {
      const { data, error } = await supabase.rpc("search_workspaces", {
        _search: term.trim() ? term : null,
        _category: category,
        _limit: SEARCH_CAP,
        _offset: 0,
      });
      if (!error && data) {
        const matched = new Set(
          data
            .map((row) => {
              const workspace = row.workspace;
              if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && "id" in workspace) {
                const id = (workspace as { id?: unknown }).id;
                return typeof id === "string" ? id : null;
              }
              return null;
            })
            .filter((id): id is string => Boolean(id)),
        );
        scoped = scoped.filter((workspace) => matched.has(workspace.id));
      } else {
        scoped = filterAssignedWorkspaces(scoped, { search: term, category });
      }
    }

    const start = page * PAGE_SIZE;
    setWorkspaces(scoped.slice(start, start + PAGE_SIZE));
    setTotal(scoped.length);
    setLoading(false);
  }, [userId, term, category, page]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => ["All", ...WORKSPACE_CATEGORIES], []);

  const ordered = useMemo(
    () => orderByAffinity(workspaces, favorites, recentOrder),
    [workspaces, favorites, recentOrder],
  );

  const pinned = useMemo(
    () => ordered.filter((w) => favorites.has(w.id) || recentOrder.slice(0, 6).includes(w.id)).slice(0, 6),
    [ordered, favorites, recentOrder],
  );

  const launch = (workspace: Workspace) => {
    open(workspace);
    setTimeout(() => { void refresh(); }, 1200);
  };

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cloud Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Launch hosted browser environments — editors, notebooks, dashboards and more.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces (typos are ok)"
              className="pl-8 h-9"
              aria-label="Search workspaces"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={category === c ? "secondary" : "ghost"}
                className="h-7 rounded-md text-xs"
                onClick={() => { setCategory(c); setPage(0); }}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        {pinned.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5 text-warning" />
              <h2 className="text-sm font-semibold text-foreground">Favorites &amp; recently opened</h2>
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {pinned.map((w) => (
                <WorkspaceTile
                  key={`pin-${w.id}`}
                  workspace={w}
                  onOpen={launch}
                  compact
                  isFavorite={favorites.has(w.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading workspaces…</p>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No workspaces found"
            description="No workspaces are assigned to you yet. Ask your administrator to assign workspaces to your account."
          />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {ordered.map((w) => (
                <WorkspaceTile
                  key={w.id}
                  workspace={w}
                  onOpen={launch}
                  isFavorite={favorites.has(w.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + ordered.length} of {total}
              </span>
              <div className="flex gap-1.5">
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs"
                  disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs"
                  disabled={page >= lastPage} onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
                >
                  Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
        <WorkspaceCredentialActivity />
      </div>
      {dialog}
    </DashboardLayout>
  );
}
