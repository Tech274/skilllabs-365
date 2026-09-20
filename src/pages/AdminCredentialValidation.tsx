import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Account {
  id: string;
  provider: string;
  display_name: string;
  status: string;
  is_default: boolean;
  last_test_status: string | null;
  last_test_message: string | null;
  last_tested_at: string | null;
}

interface PreflightField {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  source: "credential" | "config";
}

interface Preflight {
  ok: boolean;
  provider: string;
  account_name: string | null;
  status: string | null;
  fields: PreflightField[];
  missing_fields: string[];
  message: string;
  suggestion: string;
  setting: string;
}

interface TestResult { ok: boolean; message: string }

/**
 * Admin credential validation screen.
 *
 * Shows, per Resource Provider, exactly which credential/config fields are
 * missing and runs a live connection test — so a broken account (e.g.
 * "SkillTrack AWS" without a secret key) is caught here instead of surfacing to
 * a learner as an opaque ProviderConfigError at connect time.
 */
export default function AdminCredentialValidation() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { preflight: Preflight; test: TestResult | null }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("cloud-provider-accounts", { body: { action: "list" } });
    if (error) {
      toast({ title: "Unable to load resource providers", description: error.message, variant: "destructive" });
      setAccounts([]);
    } else {
      setAccounts((data?.accounts ?? data?.rows ?? []) as Account[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const validate = async (account: Account) => {
    setBusy(account.id);
    const { data, error } = await supabase.functions.invoke("cloud-provider-accounts", {
      body: { action: "preflight", id: account.id },
    });
    setBusy(null);
    if (error || !data?.preflight) {
      toast({ title: "Validation failed", description: error?.message ?? "No response", variant: "destructive" });
      return;
    }
    setResults((prev) => ({ ...prev, [account.id]: { preflight: data.preflight, test: data.test ?? null } }));
    const ok = data.preflight.ok && (data.test?.ok ?? true);
    toast({
      title: ok ? `${account.display_name} is ready` : `${account.display_name} needs attention`,
      description: data.test?.message ?? data.preflight.message,
      variant: ok ? undefined : "destructive",
    });
  };

  const activeAccounts = accounts.filter((a) => a.provider === "aws" || a.provider === "azure");
  const visible = activeAccounts.filter((a) => provider === "all" || a.provider === provider);
  const providers = [...new Set(activeAccounts.map((a) => a.provider))];

  const validateAll = async () => {
    for (const a of visible) await validate(a);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-primary" /> Credential validation
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Test each Resource Provider and see missing fields before learners try to connect.
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Cloud" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clouds</SelectItem>
                {providers.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1.5">Refresh</span>
            </Button>
            <Button size="sm" onClick={validateAll} disabled={!!busy || visible.length === 0}>
              <ShieldCheck className="h-4 w-4 mr-1.5" /> Validate all
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No resource providers"
            description="Add a cloud account under Resource Providers before validating credentials."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visible.map((a, i) => {
              const res = results[a.id];
              const ok = res ? res.preflight.ok && (res.test?.ok ?? true) : null;
              return (
                <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
                  <Card className="h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="uppercase">{a.provider}</Badge>
                          <span className="truncate">{a.display_name}</span>
                        </span>
                        {ok === null ? (
                          <Badge variant="outline">Not tested</Badge>
                        ) : ok ? (
                          <Badge variant="outline" className="text-success border-success/40 bg-success/10">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Ready
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/10">
                            <XCircle className="h-3 w-3 mr-1" /> Needs fixes
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {res ? (
                        <>
                          <p className="text-xs text-muted-foreground">{res.test?.message ?? res.preflight.message}</p>
                          <div className="space-y-1">
                            {res.preflight.fields.map((f) => (
                              <div key={`${f.source}-${f.key}`} className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  {f.present
                                    ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                                    : <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${f.required ? "text-destructive" : "text-warning"}`} />}
                                  <span className="truncate">{f.label}</span>
                                </span>
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  {f.present ? "set" : f.required ? "required" : "optional"}
                                </span>
                              </div>
                            ))}
                          </div>
                          {!res.preflight.ok && (
                            <p className="text-xs text-warning rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                              {res.preflight.suggestion}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {a.last_test_message ?? "Run a validation to check credentials and configuration."}
                        </p>
                      )}
                      <Button size="sm" variant="outline" onClick={() => validate(a)} disabled={busy === a.id}>
                        {busy === a.id
                          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
                        Validate credentials
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
