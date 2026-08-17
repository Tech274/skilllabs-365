import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Plus, Cloud, ShieldCheck, ShieldAlert, Loader2, Trash2, Pencil, PlugZap, Star,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PROVIDER_META, type CloudProvider } from "@/lib/cloud-access";

interface ProviderAccount {
  id: string;
  provider: CloudProvider;
  slug: string;
  display_name: string;
  description: string | null;
  status: string;
  is_default: boolean;
  default_region: string | null;
  config: Record<string, unknown>;
  credential_keys: Record<string, boolean>;
  last_test_status: string | null;
  last_test_message: string | null;
  last_tested_at: string | null;
  readiness?: { ready: boolean; missing: { field: string; label: string }[] } | null;
}

interface SubnetOption { id: string; label: string }

type CredField = { key: string; label: string; required: boolean };

const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder?: string }[]> = {
  azure: [
    { key: "subscription_id", label: "Subscription ID", placeholder: "00000000-0000-0000-0000-000000000000" },
    { key: "resource_group", label: "Resource Group (optional)", placeholder: "skilllabs-rg" },
    { key: "vm_admin_username", label: "VM Admin Username (optional)", placeholder: "labadmin" },
    { key: "key_vault_uri", label: "Key Vault URI (Key Vault auth mode)", placeholder: "https://my-vault.vault.azure.net" },
    { key: "key_vault_secret_name", label: "Key Vault Secret Name (optional)", placeholder: "lab-vm-admin-password" },
    { key: "managed_identity_id", label: "User-assigned Managed Identity ID (optional)", placeholder: "/subscriptions/.../userAssignedIdentities/<name>" },
    { key: "role_definition_id", label: "Role Definition ID (optional)", placeholder: "Reader by default" },
  ],
  aws: [
    { key: "default_role_arn", label: "Default Role ARN", placeholder: "arn:aws:iam::123456789012:role/LabAccess" },
    { key: "external_id", label: "External ID (optional)" },
  ],
  gcp: [
    { key: "project_id", label: "Project ID" },
  ],
};

const emptyForm = {
  id: "" as string | null,
  provider: "azure" as CloudProvider,
  display_name: "",
  description: "",
  default_region: "",
  status: "active",
  is_default: false,
  config: {} as Record<string, string>,
  credentials: {} as Record<string, string>,
};

export default function AdminResourceProviders() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [credFields, setCredFields] = useState<Record<string, CredField[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderAccount | null>(null);
  const [subnets, setSubnets] = useState<SubnetOption[]>([]);
  const [loadingSubnets, setLoadingSubnets] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const call = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("cloud-provider-accounts", { body: payload });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(String(data.error));
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      setAccounts(data.accounts ?? []);
      setCredFields(data.credential_fields ?? {});
    } catch (e) {
      toast({ title: "Failed to load resource providers", description: (e as Error).message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    return accounts.reduce<Record<string, ProviderAccount[]>>((acc, a) => {
      (acc[a.provider] ||= []).push(a);
      return acc;
    }, {});
  }, [accounts]);

  const loadSubnets = async () => {
    if (!form.id) {
      toast({ title: "Save the account first", description: "Subnets are read using this account's credentials.", variant: "destructive" });
      return;
    }
    setLoadingSubnets(true);
    try {
      const data = await call({ action: "list_subnets", id: form.id });
      const options: SubnetOption[] = [];
      for (const v of data.vnets ?? []) {
        for (const sn of v.subnets ?? []) {
          options.push({ id: sn.id, label: `${v.name} / ${sn.name} — ${sn.addressPrefix ?? "?"} (${v.location})` });
        }
      }
      setSubnets(options);
      if (!options.length) toast({ title: "No subnets found", description: "Create a virtual network in this subscription first.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Could not read subnets", description: (e as Error).message, variant: "destructive" });
    }
    setLoadingSubnets(false);
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.display_name.trim()) errors.display_name = "Name is required.";
    if (form.provider === "azure") {
      const cfg = form.config;
      const existing = accounts.find((a) => a.id === form.id);
      const credSet = (k: string) => Boolean(form.credentials[k]?.trim() || existing?.credential_keys?.[k]);
      if (!cfg.subscription_id?.trim()) errors.subscription_id = "Subscription ID is required.";
      if (!credSet("tenant_id")) errors.tenant_id = "Directory (tenant) ID is required.";
      if (!credSet("client_id")) errors.client_id = "Application (client) ID is required.";
      if (!credSet("client_secret")) errors.client_secret = "Client Secret Value is required.";
      if (!cfg.subnet_id?.trim()) errors.subnet_id = "Subnet ID is required before labs can launch. Use “Load subnets”.";
      const mode = cfg.vm_auth_mode || "password";
      if (mode === "password" && !credSet("vm_admin_password")) {
        errors.vm_admin_password = "VM Admin Password is required for password auth mode.";
      }
      if (mode === "key_vault" && !cfg.key_vault_uri?.trim()) {
        errors.key_vault_uri = "Key Vault URI is required for Key Vault auth mode.";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const openCreate = () => { setForm({ ...emptyForm, config: { vm_auth_mode: "password" }, credentials: {} }); setSubnets([]); setFormErrors({}); setDialogOpen(true); };

  const openEdit = (a: ProviderAccount) => {
    setForm({
      id: a.id,
      provider: a.provider,
      display_name: a.display_name,
      description: a.description ?? "",
      default_region: a.default_region ?? "",
      status: a.status,
      is_default: a.is_default,
      config: Object.fromEntries(Object.entries(a.config ?? {}).map(([k, v]) => [k, String(v ?? "")])),
      credentials: {},
    });
    setSubnets([]);
    setFormErrors({});
    setDialogOpen(true);
  };

  const save = async () => {
    if (!validate()) {
      toast({ title: "Fix the highlighted fields", description: "Azure lab provisioning needs these values.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await call({
        action: form.id ? "update" : "create",
        id: form.id,
        provider: form.provider,
        display_name: form.display_name,
        description: form.description,
        default_region: form.default_region,
        status: form.status,
        is_default: form.is_default,
        config: form.config,
        credentials: form.credentials,
      });
      toast({ title: form.id ? "Provider updated" : "Provider added" });
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
    setSaving(false);
  };

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const data = await call({ action: "test", id });
      const ok = data?.result?.ok;
      toast({
        title: ok ? "Connection successful" : "Connection failed",
        description: data?.result?.message,
        variant: ok ? undefined : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" });
    }
    setTestingId(null);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await call({ action: "delete", id: deleteTarget.id });
      toast({ title: "Provider removed" });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const providerCreds = credFields[form.provider] ?? [];
  const providerConfig = CONFIG_FIELDS[form.provider] ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Resource Providers</h1>
            <p className="text-sm text-muted-foreground">
              Register multiple cloud subscriptions and accounts used to issue public cloud lab access.
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Add provider account
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="No cloud accounts yet"
            description="Add an Azure subscription, AWS account, or another cloud provider to start issuing lab access."
            hint="Use the Add provider account button above."
          />
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([provider, list]) => {
              const meta = PROVIDER_META[provider as CloudProvider];
              return (
                <div key={provider} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cloud className={`h-4 w-4 ${meta?.color ?? ""}`} />
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {meta?.label ?? provider}
                    </h2>
                    <Badge variant="outline">{list.length}</Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((a, i) => (
                      <motion.div
                        key={a.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <Card className={`h-full border ${meta?.bg ?? ""}`}>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <CardTitle className="flex items-center gap-2 text-base">
                                  {a.display_name}
                                  {a.is_default && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                                </CardTitle>
                                <CardDescription className="font-mono text-xs">{a.slug}</CardDescription>
                              </div>
                              <Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3 text-sm">
                            {a.description && <p className="text-muted-foreground">{a.description}</p>}
                            <div className="space-y-1 text-xs text-muted-foreground">
                              {Object.entries(a.config ?? {}).slice(0, 3).map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-2">
                                  <span>{k}</span>
                                  <span className="truncate font-mono text-foreground/80">{String(v)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between gap-2">
                                <span>region</span>
                                <span className="font-mono text-foreground/80">{a.default_region || "—"}</span>
                              </div>
                            </div>
                            {a.readiness && !a.readiness.ready && (
                              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                  Lab launches are blocked — missing: {a.readiness.missing.map((m) => m.label).join(", ")}
                                </span>
                              </div>
                            )}
                            {a.readiness?.ready && (
                              <Badge variant="outline" className="gap-1 text-[10px] border-success/40 text-success">
                                <ShieldCheck className="h-3 w-3" /> Ready for lab VMs
                              </Badge>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(a.credential_keys ?? {}).filter(([, set]) => set).map(([k]) => (
                                <Badge key={k} variant="outline" className="text-[10px]">{k} set</Badge>
                              ))}
                            </div>
                            <div className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                              a.last_test_status === "ok"
                                ? "border-success/30 bg-success/5 text-success"
                                : a.last_test_status
                                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                                  : "border-border text-muted-foreground"
                            }`}>
                              {a.last_test_status === "ok"
                                ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                              <span className="break-words">
                                {a.last_test_message || "Not tested yet."}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button size="sm" variant="outline" className="gap-1" disabled={testingId === a.id} onClick={() => test(a.id)}>
                                {testingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                                Test
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => openEdit(a)}>
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </Button>
                              <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => setDeleteTarget(a)}>
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit provider account" : "Add provider account"}</DialogTitle>
            <DialogDescription>
              Credentials are stored server-side and are never returned to the browser.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cloud provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) => setForm({ ...form, provider: v as CloudProvider, config: {}, credentials: {} })}
                  disabled={Boolean(form.id)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROVIDER_META) as CloudProvider[]).map((p) => (
                      <SelectItem key={p} value={p}>{PROVIDER_META[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Default region</Label>
                <Input
                  value={form.default_region}
                  onChange={(e) => setForm({ ...form, default_region: e.target.value })}
                  placeholder="eastus / us-east-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Azure — Training Subscription"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this account is used for"
              />
            </div>

            {providerConfig.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuration</p>

                {form.provider === "azure" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">VM access mode</Label>
                      <Select
                        value={form.config.vm_auth_mode || "password"}
                        onValueChange={(v) => setForm({ ...form, config: { ...form.config, vm_auth_mode: v } })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="password">Stored VM admin password</SelectItem>
                          <SelectItem value="key_vault">Key Vault secret</SelectItem>
                          <SelectItem value="managed_identity">Managed identity (no stored password)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Managed identity attaches an identity to each lab VM and uses an ephemeral bootstrap
                        credential that is never stored. Key Vault reads the password at provision time.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs">Subnet</Label>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={loadSubnets} disabled={loadingSubnets}>
                          {loadingSubnets ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
                          Load subnets
                        </Button>
                      </div>
                      {subnets.length > 0 ? (
                        <Select
                          value={form.config.subnet_id ?? ""}
                          onValueChange={(v) => setForm({ ...form, config: { ...form.config, subnet_id: v } })}
                        >
                          <SelectTrigger><SelectValue placeholder="Select a VNet / subnet" /></SelectTrigger>
                          <SelectContent>
                            {subnets.map((sn) => (
                              <SelectItem key={sn.id} value={sn.id}>{sn.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Input
                        value={form.config.subnet_id ?? ""}
                        placeholder="/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/virtualNetworks/<vnet>/subnets/<subnet>"
                        onChange={(e) => setForm({ ...form, config: { ...form.config, subnet_id: e.target.value } })}
                      />
                      {formErrors.subnet_id && <p className="text-[11px] text-destructive">{formErrors.subnet_id}</p>}
                    </div>
                  </>
                )}

                {providerConfig.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      value={form.config[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                    />
                    {formErrors[f.key] && <p className="text-[11px] text-destructive">{formErrors[f.key]}</p>}
                  </div>
                ))}
              </div>
            )}

            {providerCreds.length > 0 ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Credentials {form.id && <span className="normal-case font-normal">— leave blank to keep existing</span>}
                </p>
                {providerCreds.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      type={f.key.includes("secret") || f.key.includes("token") || f.key.includes("password") ? "password" : "text"}
                      autoComplete="new-password"
                      value={form.credentials[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, credentials: { ...form.credentials, [f.key]: e.target.value } })}
                    />
                    {formErrors[f.key] && <p className="text-[11px] text-destructive">{formErrors[f.key]}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                Session issuing for this provider is not implemented yet — you can still register the account for planning.
              </p>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Default for this provider</p>
                <p className="text-xs text-muted-foreground">Used by templates with no explicit account.</p>
              </div>
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Disabled accounts cannot issue new sessions.</p>
              </div>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(v) => setForm({ ...form, status: v ? "active" : "disabled" })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {form.id ? "Save changes" : "Add provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stored credentials for this account will be permanently removed. Templates using it must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
