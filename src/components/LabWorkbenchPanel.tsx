import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { KeyRound, Copy, Eye, EyeOff, FolderOpen, Plus, Trash2, Loader2 } from "lucide-react";
import {
  listLabSecrets, listLabFolders, listMyFolderNotes, saveMyFolderNote, deleteMyFolderNote,
  maskSecret, type LabSecret, type LabFolder, type LabFolderNote,
} from "@/lib/lab-workbench";

interface Props {
  labTemplateId: string;
  userId?: string | null;
  className?: string;
  /** Compact rendering for narrow columns (e.g. beside the remote desktop). */
  dense?: boolean;
}

async function copyText(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: `${what} copied`, description: "Paste it inside your lab machine." });
  } catch {
    toast({ title: "Copy failed", description: "Select the value and copy it manually.", variant: "destructive" });
  }
}

export function LabWorkbenchPanel({ labTemplateId, userId, className, dense = false }: Props) {
  const [secrets, setSecrets] = useState<LabSecret[]>([]);
  const [folders, setFolders] = useState<LabFolder[]>([]);
  const [notes, setNotes] = useState<LabFolderNote[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [newPath, setNewPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, f, n] = await Promise.all([
        listLabSecrets(labTemplateId).catch(() => []),
        listLabFolders(labTemplateId).catch(() => []),
        userId ? listMyFolderNotes(labTemplateId, userId).catch(() => []) : Promise.resolve([]),
      ]);
      setSecrets(s);
      setFolders(f);
      setNotes(n);
    } finally {
      setLoading(false);
    }
  }, [labTemplateId, userId]);

  useEffect(() => { void load(); }, [load]);

  const addNote = async () => {
    if (!userId || !newPath.trim()) return;
    setSaving(true);
    try {
      await saveMyFolderNote({ lab_template_id: labTemplateId, user_id: userId, path: newPath });
      setNewPath("");
      await load();
    } catch (e) {
      toast({ title: "Could not save folder", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (id: string) => {
    try {
      await deleteMyFolderNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      toast({ title: "Could not remove folder", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lab workbench…
        </CardContent>
      </Card>
    );
  }

  if (!secrets.length && !folders.length && !userId) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <KeyRound className="h-4 w-4 text-primary" /> Lab workbench
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Lab keys</p>
          {secrets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys are attached to this lab.</p>
          ) : (
            <div className={cn("grid gap-2", dense ? "grid-cols-1" : "sm:grid-cols-2")}>
              {secrets.map((s) => (
                <div key={s.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        aria-label={revealed[s.id] ? `Hide ${s.label}` : `Show ${s.label}`}
                        onClick={() => setRevealed((p) => ({ ...p, [s.id]: !p[s.id] }))}
                      >
                        {revealed[s.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        aria-label={`Copy ${s.label}`}
                        onClick={() => copyText(s.secret_value, s.label)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <code className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                    {revealed[s.id] ? s.secret_value : maskSecret(s.secret_value)}
                  </code>
                  {s.hint && <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" /> Working folders
          </p>
          {folders.length > 0 && (
            <div className="space-y-1.5">
              {folders.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="min-w-0">
                    <code className="block truncate font-mono text-xs">{f.path}</code>
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">Lab</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Copy ${f.path}`} onClick={() => copyText(f.path, "Folder path")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {userId && (
            <>
              {notes.map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{n.path}</code>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Copy ${n.path}`} onClick={() => copyText(n.path, "Folder path")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${n.path}`} onClick={() => removeNote(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addNote(); } }}
                  placeholder="/home/labuser/my-project"
                  className="h-8 font-mono text-xs"
                  aria-label="Folder you worked in"
                />
                <Button size="sm" className="h-8" disabled={saving || !newPath.trim()} onClick={addNote}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Saved folder paths are notes for your next session — files stay inside the lab machine.
              </p>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
