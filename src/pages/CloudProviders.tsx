import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cloud, KeyRound, ShieldCheck, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CloudProviderHealthPanel } from "@/components/CloudProviderHealthPanel";

interface ProviderState {
  config: Record<string, any>;
  updated_at: string | null;
  secrets: Record<string, boolean>;
  required_secrets: string[];
}

interface ApiPayload {
  aws: ProviderState;
  azure: ProviderState;
}

const AWS_FIELDS: Array<{ key: string; label: string; placeholder?: string; help?: string }> = [
  { key: "default_region", label: "Default region", placeholder: "us-east-1" },
  { key: "default_role_arn", label: "Default Role ARN", placeholder: "arn:aws:iam::123456789012:role/LovableLabSession", help: "Per-template provider_config.role_arn overrides this." },
  { key: "session_policy", label: "Session policy (inline JSON)", help: "Optional. Restricts what the federated session can do." },
];

const AZURE_FIELDS: Array<{ key: string; label: string; placeholder?: string; help?: string }> = [
  { key: "subscription_id", label: "Subscription ID", placeholder: "00000000-0000-0000-0000-000000000000" },
  { key: "resource_group", label: "Resource group (optional)", placeholder: "rg-lovable-labs", help: "Empty = subscription-scoped assignment." },
  { key: "role_definition_id", label: "Role definition ID (GUID or full path)", placeholder: "acdd72a7-3385-48ef-bd42-f606fba81ae7", help: "Default = built-in Reader." },
  { key: "tenant_id", label: "Tenant ID (for portal deep link)", placeholder: "Inherits AZURE_TENANT_ID" },
];

export default function CloudProviders() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: res, error } = await supabase.functions.invoke<ApiPayload>("cloud-provider-config", { method: "GET" });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setData(res ?? null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async (provider: "aws" | "azure", cfg: Record<string, any>) => {
    setSaving(provider);
    const { error } = await supabase.functions.invoke("cloud-provider-config", {
      method: "POST",
      body: { provider, config: cfg },
    });
    setSaving(null);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Saved" }); load(); }
  };

  if (loading || !data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
            <Cloud className="h-7 w-7 text-primary" /> Cloud Providers
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage AWS and Azure credentials and defaults used when generating user session links.
          </p>
        </div>

        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertTitle>How credentials are stored</AlertTitle>
          <AlertDescription>
            API keys and secrets are stored in encrypted backend secrets — never in this form or the browser.
            Use the secret prompts to set or rotate them. Everything you edit on this page is non-secret
            configuration (regions, role ARNs, subscription IDs).
          </AlertDescription>
        </Alert>

        <CloudProviderHealthPanel />



        <Tabs defaultValue="aws">
          <TabsList>
            <TabsTrigger value="aws">AWS</TabsTrigger>
            <TabsTrigger value="azure">Azure</TabsTrigger>
          </TabsList>

          <TabsContent value="aws" className="space-y-4">
            <ProviderCard
              title="AWS STS Federation"
              description="Used to AssumeRole and mint a console sign-in URL for each session."
              state={data.aws}
              fields={AWS_FIELDS}
              saving={saving === "aws"}
              onSave={(cfg) => save("aws", cfg)}
            />
          </TabsContent>

          <TabsContent value="azure" className="space-y-4">
            <ProviderCard
              title="Azure RBAC Federation"
              description="Used to create a time-boxed role assignment on the configured scope; user logs in to the Azure portal deep link."
              state={data.azure}
              fields={AZURE_FIELDS}
              saving={saving === "azure"}
              onSave={(cfg) => save("azure", cfg)}
              extra={(cfg, set) => (
                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 p-3">
                  <div>
                    <Label className="text-sm">Use Azure PIM (time-boxed schedule request)</Label>
                    <p className="text-xs text-muted-foreground">Requires PIM SKU. Falls back to standard role assignment if disabled.</p>
                  </div>
                  <Switch checked={Boolean(cfg.use_pim)} onCheckedChange={(v) => set({ ...cfg, use_pim: v })} />
                </div>
              )}
            />
          </TabsContent>
        </Tabs>
      </motion.div>
    </DashboardLayout>
  );
}

interface ProviderCardProps {
  title: string;
  description: string;
  state: ProviderState;
  fields: Array<{ key: string; label: string; placeholder?: string; help?: string }>;
  saving: boolean;
  onSave: (cfg: Record<string, any>) => void;
  extra?: (cfg: Record<string, any>, set: (c: Record<string, any>) => void) => React.ReactNode;
}

function ProviderCard({ title, description, state, fields, saving, onSave, extra }: ProviderCardProps) {
  const [cfg, setCfg] = useState<Record<string, any>>(state.config || {});

  const missing = state.required_secrets.filter((n) => !state.secrets[n]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {missing.length === 0 ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
              <ShieldCheck className="mr-1 h-3 w-3" /> Ready
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/40 text-amber-400">
              <AlertTriangle className="mr-1 h-3 w-3" /> {missing.length} secret{missing.length > 1 ? "s" : ""} missing
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label className="text-xs uppercase text-muted-foreground">Required secrets</Label>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {state.required_secrets.map((n) => (
              <div key={n} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{n}</span>
                {state.secrets[n] ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">SET</Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">MISSING</Badge>
                )}
              </div>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ask an admin with secret-management access to set {missing.map((m) => <code key={m} className="mx-0.5">{m}</code>)} in backend secrets.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                value={cfg[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value || null })}
              />
              {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
            </div>
          ))}
        </div>

        {extra?.(cfg, setCfg)}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {state.updated_at ? `Last updated ${new Date(state.updated_at).toLocaleString()}` : "Not saved yet"}
          </p>
          <Button onClick={() => onSave(cfg)} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
