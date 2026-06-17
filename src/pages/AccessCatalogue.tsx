import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, Cloud, BookOpen, Users as UsersIcon, Clock, CreditCard, Filter } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  PROVIDER_META, TEMPLATE_STATUS_STYLE, formatDuration, formatCredit,
  type AccessTemplate, type CloudProvider,
} from "@/lib/cloud-access";

interface TemplateWithCounts extends AccessTemplate {
  batch_count?: number;
  workspace_batch_count?: number;
  lab_count?: number;
}

const emptyDraft = {
  name: "",
  description: "",
  provider: "aws" as CloudProvider,
  validity_days: 30,
  credit_limit: 50,
  session_duration_minutes: 60,
  region: "us-east-1",
  self_enroll: false,
  refresh_allowed: true,
};

export default function AccessCatalogue() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("access_templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load templates", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const ids = (data || []).map((t) => t.id);
    let bCounts: Record<string, number> = {};
    let wbCounts: Record<string, number> = {};
    if (ids.length) {
      const [{ data: bRows }, { data: wbRows }] = await Promise.all([
        supabase.from("template_batches").select("template_id").in("template_id", ids),
        supabase.from("template_workspace_batches").select("template_id").in("template_id", ids),
      ]);
      bCounts = (bRows || []).reduce<Record<string, number>>((acc, r) => {
        if (r.template_id) acc[r.template_id] = (acc[r.template_id] || 0) + 1;
        return acc;
      }, {});
      wbCounts = (wbRows || []).reduce<Record<string, number>>((acc, r) => {
        if (r.template_id) acc[r.template_id] = (acc[r.template_id] || 0) + 1;
        return acc;
      }, {});
    }

    setTemplates((data || []).map((t) => ({
      ...t,
      batch_count: bCounts[t.id] || 0,
      workspace_batch_count: wbCounts[t.id] || 0,
      lab_count: bCounts[t.id] || 0,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const filtered = templates.filter((t) => {
    if (providerFilter !== "all" && t.provider !== providerFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const createTemplate = async () => {
    if (!draft.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("access_templates")
      .insert({ ...draft, created_by: user?.id })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Template created", description: "Draft saved." });
    setCreateOpen(false);
    setDraft(emptyDraft);
    if (data) navigate(`/admin/access-templates/${data.id}`);
  };

  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cloud Access Catalogue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Publish session-based templates that grant temporary, scoped access to public cloud consoles.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Template
          </Button>
        </header>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-full sm:w-44"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              <SelectItem value="aws">AWS</SelectItem>
              <SelectItem value="azure">Azure</SelectItem>
              <SelectItem value="gcp">GCP</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-56 rounded-xl border border-border bg-card/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title={templates.length === 0 ? "No templates yet" : "No templates match your filters"}
            description={templates.length === 0
              ? "Create your first cloud access template to publish session-based access to AWS, Azure, or GCP consoles."
              : "Try adjusting search or filter to see more templates."}
            hint={templates.length === 0 ? 'Click "New Template" to start.' : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((t, idx) => {
              const meta = PROVIDER_META[t.provider as CloudProvider];
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => navigate(`/admin/access-templates/${t.id}`)}
                  className="group rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer overflow-hidden"
                >
                  <div className={`p-4 border-b border-border ${meta.bg}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-mono font-semibold uppercase tracking-wider ${meta.color}`}>
                        {meta.label}
                      </span>
                      <Badge variant="outline" className={TEMPLATE_STATUS_STYLE[t.status] || ""}>
                        {t.status}
                      </Badge>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-foreground line-clamp-1">{t.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1 min-h-[2rem]">
                      {t.description || meta.tagline}
                    </p>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>{t.batch_count} batches</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <UsersIcon className="h-3.5 w-3.5" />
                      <span>{t.workspace_batch_count} workspaces</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{t.validity_days}d validity</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CreditCard className="h-3.5 w-3.5" />
                      <span>{formatCredit(t.credit_limit)} credit</span>
                    </div>
                  </div>
                  <div className="px-4 pb-4">
                    <Button variant="ghost" size="sm" className="w-full text-primary group-hover:bg-primary/10">
                      View Template →
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Access Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Template name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="AWS Cloud Practitioner Lab" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Provider</Label>
                  <Select value={draft.provider} onValueChange={(v) => setDraft({ ...draft, provider: v as CloudProvider })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aws">AWS</SelectItem>
                      <SelectItem value="azure">Azure</SelectItem>
                      <SelectItem value="gcp">GCP (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Region</Label>
                  <Input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} />
                </div>
                <div>
                  <Label>Validity (days)</Label>
                  <Input type="number" min={1} value={draft.validity_days} onChange={(e) => setDraft({ ...draft, validity_days: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Session duration (min)</Label>
                  <Input type="number" min={5} value={draft.session_duration_minutes} onChange={(e) => setDraft({ ...draft, session_duration_minutes: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Credit limit</Label>
                  <Input type="number" min={0} step="0.01" value={draft.credit_limit} onChange={(e) => setDraft({ ...draft, credit_limit: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <Label className="text-xs">Allow self-enrollment</Label>
                <Switch checked={draft.self_enroll} onCheckedChange={(v) => setDraft({ ...draft, self_enroll: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Allow credential refresh</Label>
                <Switch checked={draft.refresh_allowed} onCheckedChange={(v) => setDraft({ ...draft, refresh_allowed: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={createTemplate} disabled={saving}>{saving ? "Saving..." : "Create draft"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
