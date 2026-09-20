import { DashboardLayout } from "@/components/DashboardLayout";
import { errorMessage } from "@/lib/edge-error";
import { motion } from "framer-motion";
import { Clock, Server, Bell, Shield, Save, DollarSign, Loader2, Network, Gauge, Plus, Trash2, PlayCircle, Globe, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  BUDGET_POLICY_KEY, DEFAULT_BUDGET_POLICY, normalizeBudgetPolicy, validateBudgetPolicy,
  type BudgetPolicy, type CloudProviderKey,
} from "@/lib/budget-policy";


export default function Settings() {
  const [idleTimeout, setIdleTimeout] = useState(20);
  const [maxIdleTimeout, setMaxIdleTimeout] = useState(60);
  const [defaultDuration, setDefaultDuration] = useState(120);
  const [maxDuration, setMaxDuration] = useState(240);
  const [defaultVmSize, setDefaultVmSize] = useState('Standard_B2s');
  const [allowedSizes, setAllowedSizes] = useState({
    'Standard_B2s': true, 'Standard_B2ms': true, 'Standard_B4ms': true, 'Standard_D2s_v3': false,
  });
  const [notifications, setNotifications] = useState({
    wafAlerts: true, idleWarnings: true, healthEvents: true, emailDigest: false,
    slackIntegration: false, webhookUrl: '',
  });
  const [security, setSecurity] = useState({
    enforceClipboardPolicy: true, blockPublicAccess: true, requireMfa: false,
    sessionRecording: false, auditRetentionDays: 90,
  });
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [budgetPeriod, setBudgetPeriod] = useState<"daily" | "monthly">("monthly");
  const [budgetCap, setBudgetCap] = useState(100);
  const [budgetPolicy, setBudgetPolicy] = useState<BudgetPolicy>(DEFAULT_BUDGET_POLICY);

  const [perLabThreshold, setPerLabThreshold] = useState(0);
  const [perLabAlertEnabled, setPerLabAlertEnabled] = useState(false);
  const [network, setNetwork] = useState({
    resource_group: "",
    vnet_name: "skilllabs-vnet",
    vnet_cidr: "10.30.0.0/16",
    subnet_name: "default",
    subnet_cidr: "10.30.1.0/24",
    connectivity_check_enabled: false,
    connectivity_check_timeout_ms: 5000,
  });
  const [capacity, setCapacity] = useState<{
    enabled: boolean; max_active_sessions: number; warn_at_percent: number; daily_spend_limit_usd: number;
    regions: { region: string; max_active_vms: number | null; daily_spend_limit_usd: number | null }[];
  }>({
    enabled: true,
    max_active_sessions: 25,
    warn_at_percent: 80,
    daily_spend_limit_usd: 50,
    regions: [],
  });
  const [gateway, setGateway] = useState({
    public_base_url: "",
    force_https: false,
  });
  interface NetworkIssue { code: string; message: string; setting: string; suggestion: string }
  interface NetworkValidation {
    ok: boolean; summary: string; region: string; vnetRegion: string | null;
    subnetId: string | null; issues: NetworkIssue[]; warnings: string[]; checkedAt: string;
  }
  const [netValidation, setNetValidation] = useState<NetworkValidation | null>(null);
  const [netValidatedKey, setNetValidatedKey] = useState<string | null>(null);
  const [savedNetworkKey, setSavedNetworkKey] = useState<string | null>(null);
  const [validatingNetwork, setValidatingNetwork] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Validates the browser-facing gateway URL; returns an error message or null. */
  const validateGatewayUrl = (raw: string): string | null => {
    const value = raw.trim();
    if (!value) return null;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "Enter a full URL including https:// (e.g. https://gateway.example.com/guacamole).";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "Only http:// and https:// URLs are supported.";
    }
    const host = parsed.hostname;
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    // An IPv4 address glued in front of a domain (3.6.228.159.example.com) never resolves.
    if (!isIp && /^\d{1,3}(\.\d{1,3}){3}\./.test(host)) {
      return `"${host}" is not a valid hostname — it mixes an IP address with a domain. Use either the IP (https://${host.split(".").slice(0, 4).join(".")}) or a real DNS name.`;
    }
    if (!isIp && !host.includes(".")) {
      return "Hostname must be a fully qualified domain or an IP address.";
    }
    return null;
  };

  const gatewayUrlError = validateGatewayUrl(gateway.public_base_url);


  useEffect(() => {
    Promise.all([
      supabase.from("platform_settings").select("key, value").eq("key", "budget_cap").maybeSingle(),
      supabase.from("platform_settings").select("key, value").eq("key", "per_lab_cost_alert").maybeSingle(),
      supabase.from("platform_settings").select("key, value").eq("key", "azure_network_defaults").maybeSingle(),
      supabase.from("platform_settings").select("key, value").eq("key", "capacity_cost_alerts").maybeSingle(),
      supabase.from("platform_settings").select("key, value").eq("key", "guacamole_gateway").maybeSingle(),
      supabase.from("platform_settings").select("key, value").eq("key", BUDGET_POLICY_KEY).maybeSingle(),
    ]).then(([budgetData, labAlertData, networkData, capacityData, gatewayData, policyData]) => {
      if (budgetData.data?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        const v = budgetData.data.value as any;
        setBudgetEnabled(v.enabled ?? false);
        setBudgetPeriod(v.period ?? "monthly");
        setBudgetCap(v.amount ?? 100);
      }
      if (labAlertData.data?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        const v = labAlertData.data.value as any;
        setPerLabAlertEnabled(v.enabled ?? false);
        setPerLabThreshold(v.threshold ?? 0);
      }
      if (networkData.data?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        const v = networkData.data.value as any;
        setNetwork((prev) => {
          const next = { ...prev, ...v };
          setSavedNetworkKey(JSON.stringify({
            resource_group: String(next.resource_group ?? "").trim(),
            vnet_name: String(next.vnet_name ?? "").trim(),
            subnet_name: String(next.subnet_name ?? "").trim(),
            vnet_cidr: String(next.vnet_cidr ?? "").trim(),
            subnet_cidr: String(next.subnet_cidr ?? "").trim(),
          }));
          return next;
        });
      }
      if (capacityData.data?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        const v = capacityData.data.value as any;
        setCapacity((prev) => ({ ...prev, ...v, regions: Array.isArray(v.regions) ? v.regions : [] }));
      }
      if (gatewayData.data?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        const v = gatewayData.data.value as any;
        setGateway((prev) => ({ ...prev, ...v }));
      }
      if (policyData.data?.value) setBudgetPolicy(normalizeBudgetPolicy(policyData.data.value));
    });
  }, []);

  const budgetPolicyErrors = validateBudgetPolicy(budgetPolicy);

  /** Identity of the network values that a validation result applies to. */
  const networkKey = JSON.stringify({
    resource_group: network.resource_group.trim(),
    vnet_name: network.vnet_name.trim(),
    subnet_name: network.subnet_name.trim(),
    vnet_cidr: network.vnet_cidr.trim(),
    subnet_cidr: network.subnet_cidr.trim(),
  });
  const networkValidated = netValidatedKey === networkKey && netValidation?.ok === true;
  /** Only unsaved network edits have to pass validation before a save. */
  const networkChanged = savedNetworkKey !== null && savedNetworkKey !== networkKey;

  /** Live-check the VNet/subnet/resource group against Azure before allowing a save. */
  const validateNetwork = async () => {
    setValidatingNetwork(true);
    try {
      const { data, error } = await supabase.functions.invoke("cloud-provider-accounts", {
        body: { action: "validate_network", network },
      });
      if (error) throw error;
      const validation = data?.validation as NetworkValidation;
      setNetValidation(validation);
      setNetValidatedKey(networkKey);
      toast({
        title: validation.ok ? "Network settings are valid" : "Network settings are invalid",
        description: validation.summary,
        variant: validation.ok ? "default" : "destructive",
      });
    } catch (err) {
      setNetValidation(null);
      setNetValidatedKey(null);
      toast({ title: "Validation failed", description: errorMessage(err), variant: "destructive" });
    } finally {
      setValidatingNetwork(false);
    }
  };

  const handleSave = async () => {
    if (gatewayUrlError) {
      toast({ title: "Invalid gateway URL", description: gatewayUrlError, variant: "destructive" });
      return;
    }
    if (budgetPolicyErrors.length > 0) {
      toast({ title: "Invalid budget policy", description: budgetPolicyErrors[0], variant: "destructive" });
      return;
    }
    // Saving a VNet/subnet that does not exist causes InvalidResourceReference at
    // NIC creation, so the network settings must pass live validation first.
    if (networkChanged && !networkValidated) {
      toast({
        title: "Validate the Azure network first",
        description: netValidation && netValidatedKey === networkKey
          ? netValidation.summary
          : "Run \"Validate Azure Network Settings\" on the Network tab — the VNet, subnet and resource group must exist in the lab region before settings can be saved.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {

      const results = await Promise.all([
        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: "budget_cap", value: { enabled: budgetEnabled, period: budgetPeriod, amount: budgetCap } as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),
        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: BUDGET_POLICY_KEY, value: budgetPolicy as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),

        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: "per_lab_cost_alert", value: { enabled: perLabAlertEnabled, threshold: perLabThreshold } as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),
        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: "azure_network_defaults", value: network as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),
        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: "capacity_cost_alerts", value: capacity as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),
        supabase.from("platform_settings").upsert(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
          { key: "guacamole_gateway", value: gateway as any, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        ),
      ]);
      const error = results.find(r => r.error)?.error;
      if (error) throw error;
      setSavedNetworkKey(networkKey);
      toast({ title: "Settings saved", description: "Platform configuration updated successfully." });
    } catch (err) {
      toast({ title: "Save failed", description: errorMessage(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runAlertCheck = async () => {
    setEvaluating(true);
    try {
      const { data, error } = await supabase.functions.invoke("capacity-cost-alerts", { body: {} });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
      const raised = (data as any)?.raised ?? 0;
      toast({
        title: raised ? `${raised} alert(s) raised` : "No thresholds breached",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated PostgREST/Json types don't model this shape; value is validated at use site
        description: `Active sessions: ${(data as any)?.metrics?.active_sessions ?? 0}.`,
      });
    } catch (err) {
      toast({ title: "Alert check failed", description: errorMessage(err), variant: "destructive" });
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Platform configuration and preferences</p>
          </div>
          <Button onClick={handleSave} className="gap-2" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
          </Button>
        </div>

        <Tabs defaultValue="timeouts">
          <TabsList className="flex-wrap">
            <TabsTrigger value="timeouts" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Timeouts</TabsTrigger>
            <TabsTrigger value="vm" className="gap-1.5"><Server className="h-3.5 w-3.5" /> VM Limits</TabsTrigger>
            <TabsTrigger value="budget" className="gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Budget</TabsTrigger>
            <TabsTrigger value="network" className="gap-1.5"><Network className="h-3.5 w-3.5" /> Network</TabsTrigger>
            <TabsTrigger value="gateway" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> Gateway</TabsTrigger>
            <TabsTrigger value="capacity" className="gap-1.5"><Gauge className="h-3.5 w-3.5" /> Capacity &amp; Cost</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Security</TabsTrigger>
          </TabsList>

          {/* Timeouts */}
          <TabsContent value="timeouts" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-2xl">
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">Default Idle Timeout</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Auto-stop VMs after this period of inactivity</p>
                </div>
                <div className="flex items-center gap-4">
                  <Slider value={[idleTimeout]} onValueChange={v => setIdleTimeout(v[0])} min={5} max={60} step={5} className="flex-1" />
                  <span className="text-sm font-mono text-foreground w-16 text-right">{idleTimeout} min</span>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">Max Idle Timeout</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Maximum idle timeout instructors can configure per lab</p>
                </div>
                <div className="flex items-center gap-4">
                  <Slider value={[maxIdleTimeout]} onValueChange={v => setMaxIdleTimeout(v[0])} min={10} max={120} step={5} className="flex-1" />
                  <span className="text-sm font-mono text-foreground w-16 text-right">{maxIdleTimeout} min</span>
                </div>
              </div>
              <div className="border-t border-border pt-6 space-y-4">
                <div>
                  <Label className="text-base font-semibold">Default Session Duration</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Default lab session length</p>
                </div>
                <div className="flex items-center gap-4">
                  <Slider value={[defaultDuration]} onValueChange={v => setDefaultDuration(v[0])} min={30} max={480} step={30} className="flex-1" />
                  <span className="text-sm font-mono text-foreground w-16 text-right">{defaultDuration} min</span>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">Max Session Duration</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Maximum session duration allowed</p>
                </div>
                <div className="flex items-center gap-4">
                  <Slider value={[maxDuration]} onValueChange={v => setMaxDuration(v[0])} min={60} max={720} step={30} className="flex-1" />
                  <span className="text-sm font-mono text-foreground w-16 text-right">{maxDuration} min</span>
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* VM Limits */}
          <TabsContent value="vm" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-2xl">
              <div>
                <Label className="text-base font-semibold">Default VM Size</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-3">Pre-selected size for new lab templates</p>
                <Select value={defaultVmSize} onValueChange={setDefaultVmSize}>
                  <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Standard_B2s">B2s (2 vCPU, 4 GB)</SelectItem>
                    <SelectItem value="Standard_B2ms">B2ms (2 vCPU, 8 GB)</SelectItem>
                    <SelectItem value="Standard_B4ms">B4ms (4 vCPU, 16 GB)</SelectItem>
                    <SelectItem value="Standard_D2s_v3">D2s v3 (2 vCPU, 8 GB)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t border-border pt-6">
                <Label className="text-base font-semibold">Allowed VM Sizes</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-4">Control which VM sizes are available for lab creation</p>
                <div className="space-y-3">
                  {Object.entries(allowedSizes).map(([size, enabled]) => (
                    <div key={size} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                      <div>
                        <p className="text-sm font-mono text-foreground">{size}</p>
                        <p className="text-xs text-muted-foreground">
                          {size === 'Standard_B2s' && '2 vCPU, 4 GB RAM – $0.042/hr'}
                          {size === 'Standard_B2ms' && '2 vCPU, 8 GB RAM – $0.083/hr'}
                          {size === 'Standard_B4ms' && '4 vCPU, 16 GB RAM – $0.166/hr'}
                          {size === 'Standard_D2s_v3' && '2 vCPU, 8 GB RAM – $0.096/hr'}
                        </p>
                      </div>
                      <Switch checked={enabled} onCheckedChange={v => setAllowedSizes(prev => ({ ...prev, [size]: v }))} />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Budget */}
          <TabsContent value="budget" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Budget Cap</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Automatically pause new lab launches when estimated spend exceeds the cap</p>
                </div>
                <Switch checked={budgetEnabled} onCheckedChange={setBudgetEnabled} />
              </div>
              {budgetEnabled && (
                <>
                  <div className="space-y-3">
                    <Label>Period</Label>
                    <Select value={budgetPeriod} onValueChange={(v) => setBudgetPeriod(v as "daily" | "monthly")}>
                      <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label>Spend Limit (USD)</Label>
                    <div className="flex items-center gap-3 max-w-xs">
                      <span className="text-lg font-semibold text-foreground">$</span>
                      <Input
                        type="number"
                        min={1}
                        value={budgetCap}
                        onChange={(e) => setBudgetCap(Number(e.target.value))}
                        className="font-mono"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When estimated spend reaches this amount, new VM provisioning will be blocked. Existing sessions will continue uninterrupted.
                    </p>
                  </div>
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <p className="text-xs text-warning font-medium">⚠️ Cost estimates are approximations based on VM uptime and published Azure pricing. Actual Azure charges may differ.</p>
                  </div>
                </>
              )}

              {/* Per-Lab Cost Alert */}
              <div className="border-t border-border pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Per-Lab Cost Alert</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Highlight labs on Cost Analytics when their estimated cost exceeds a threshold</p>
                  </div>
                  <Switch checked={perLabAlertEnabled} onCheckedChange={setPerLabAlertEnabled} />
                </div>
                {perLabAlertEnabled && (
                  <div className="space-y-3">
                    <Label>Cost Threshold (USD per lab)</Label>
                    <div className="flex items-center gap-3 max-w-xs">
                      <span className="text-lg font-semibold text-foreground">$</span>
                      <Input
                        type="number"
                        min={1}
                        value={perLabThreshold}
                        onChange={(e) => setPerLabThreshold(Number(e.target.value))}
                        className="font-mono"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Labs exceeding this cost will be flagged with a warning on the Cost Analytics page.
                    </p>
                  </div>
                )}
              </div>

              {/* Provider-aware budget policies */}
              <div className="border-t border-border pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Budget Policies</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Per-cloud caps with warning and blocking thresholds, enforced on every new lab and cloud access session
                    </p>
                  </div>
                  <Switch
                    checked={budgetPolicy.enabled}
                    onCheckedChange={(enabled) => setBudgetPolicy((p) => ({ ...p, enabled }))}
                  />
                </div>

                {budgetPolicy.enabled && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Global daily cap (USD)</Label>
                        <Input
                          type="number" min={1} className="font-mono"
                          value={budgetPolicy.global_daily_cap}
                          onChange={(e) => setBudgetPolicy((p) => ({ ...p, global_daily_cap: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Global monthly cap (USD)</Label>
                        <Input
                          type="number" min={1} className="font-mono"
                          value={budgetPolicy.global_monthly_cap}
                          onChange={(e) => setBudgetPolicy((p) => ({ ...p, global_monthly_cap: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Warn at (% of cap)</Label>
                        <Input
                          type="number" min={0} max={200} className="font-mono"
                          value={budgetPolicy.warn_at_percent}
                          onChange={(e) => setBudgetPolicy((p) => ({ ...p, warn_at_percent: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Block at (% of cap)</Label>
                        <Input
                          type="number" min={0} max={200} className="font-mono"
                          value={budgetPolicy.block_at_percent}
                          onChange={(e) => setBudgetPolicy((p) => ({ ...p, block_at_percent: Number(e.target.value) }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Monthly caps per cloud (USD)</Label>
                      <div className="grid gap-4 sm:grid-cols-3">
                        {(["aws", "azure"] as CloudProviderKey[]).map((provider) => (
                          <div key={provider} className="space-y-1.5">
                            <span className="text-xs font-medium uppercase text-muted-foreground">{provider}</span>
                            <Input
                              type="number" min={0} className="font-mono"
                              value={budgetPolicy.provider_caps[provider]}
                              onChange={(e) => setBudgetPolicy((p) => ({
                                ...p,
                                provider_caps: { ...p.provider_caps, [provider]: Number(e.target.value) },
                              }))}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Set a cap to 0 to leave that cloud uncapped. Blocked launches are recorded in the platform audit log.
                      </p>
                    </div>

                    {budgetPolicyErrors.length > 0 && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                        {budgetPolicyErrors.map((err) => (
                          <p key={err} className="text-xs text-destructive font-medium">{err}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>

          </TabsContent>

          {/* Network */}
          <TabsContent value="network" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-2xl">
              <div>
                <Label className="text-base font-semibold">Automatic Lab Network</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used when a resource provider has no Subnet ID and provisioning has to create the VNet/subnet.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Resource Group</Label>
                  <Input value={network.resource_group}
                    onChange={(e) => setNetwork(p => ({ ...p, resource_group: e.target.value }))}
                    placeholder="skillhub-labs-rg" className="font-mono" />
                  <p className="text-xs text-muted-foreground">Leave blank to use the provider account's resource group.</p>
                </div>
                <div className="space-y-2">
                  <Label>VNet Name</Label>
                  <Input value={network.vnet_name}
                    onChange={(e) => setNetwork(p => ({ ...p, vnet_name: e.target.value }))}
                    className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>VNet CIDR</Label>
                  <Input value={network.vnet_cidr}
                    onChange={(e) => setNetwork(p => ({ ...p, vnet_cidr: e.target.value }))}
                    placeholder="10.30.0.0/16" className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Subnet Name</Label>
                  <Input value={network.subnet_name}
                    onChange={(e) => setNetwork(p => ({ ...p, subnet_name: e.target.value }))}
                    className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Subnet CIDR</Label>
                  <Input value={network.subnet_cidr}
                    onChange={(e) => setNetwork(p => ({ ...p, subnet_cidr: e.target.value }))}
                    placeholder="10.30.1.0/24" className="font-mono" />
                </div>
              </div>

              <div className="border-t border-border pt-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Label className="text-base font-semibold">Validate Azure Network Settings</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Checks the resource group, VNet and subnet exist in the subscription and that the VNet region
                      matches the lab region. Saving is blocked until this passes.
                    </p>
                  </div>
                  <Button variant="outline" onClick={validateNetwork} disabled={validatingNetwork} className="gap-2">
                    {validatingNetwork ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Validate
                  </Button>
                </div>

                {netValidatedKey !== networkKey && netValidation && (
                  <p className="text-xs text-muted-foreground">
                    Network values changed since the last check — validate again before saving.
                  </p>
                )}

                {netValidation && netValidatedKey === networkKey && (
                  <div className={cn(
                    "rounded-lg border p-3 space-y-2",
                    netValidation.ok ? "border-primary/40 bg-primary/5" : "border-destructive/50 bg-destructive/10",
                  )}>
                    <div className="flex items-start gap-2">
                      {netValidation.ok
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                        : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{netValidation.summary}</p>
                        <p className="text-xs text-muted-foreground">
                          Lab region {netValidation.region}
                          {netValidation.vnetRegion ? ` · VNet region ${netValidation.vnetRegion}` : ""}
                        </p>
                      </div>
                    </div>
                    {netValidation.issues.map((issue) => (
                      <div key={issue.code} className="rounded-md border border-border/60 bg-background/60 p-2">
                        <p className="text-xs font-medium text-destructive">{issue.code}</p>
                        <p className="text-xs text-foreground">{issue.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{issue.setting} — {issue.suggestion}</p>
                      </div>
                    ))}
                    {netValidation.warnings.map((w) => (
                      <p key={w} className="text-xs text-muted-foreground">{w}</p>
                    ))}
                    {netValidation.subnetId && netValidation.ok && (
                      <p className="break-all font-mono text-[11px] text-muted-foreground">{netValidation.subnetId}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Post-Provisioning Connectivity Check</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Probe SSH (22) or RDP (3389) after the VM is created and record the result on the provisioning timeline.
                    </p>
                  </div>
                  <Switch checked={network.connectivity_check_enabled}
                    onCheckedChange={(v) => setNetwork(p => ({ ...p, connectivity_check_enabled: v }))} />
                </div>
                {network.connectivity_check_enabled && (
                  <div className="space-y-2 max-w-xs">
                    <Label>Probe Timeout (ms)</Label>
                    <Input type="number" min={1000} max={30000} step={500}
                      value={network.connectivity_check_timeout_ms}
                      onChange={(e) => setNetwork(p => ({ ...p, connectivity_check_timeout_ms: Number(e.target.value) }))}
                      className="font-mono" />
                    <p className="text-xs text-muted-foreground">
                      Lab VMs are private, so a failed probe is informational only — it never blocks provisioning.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </TabsContent>

          {/* Remote gateway (Guacamole) */}
          <TabsContent value="gateway" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-2xl">
              <div>
                <Label className="text-base font-semibold">Remote Session Gateway</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The browser-facing URL used to embed lab sessions. Must be HTTPS for the session to render inside the
                  app — an HTTP gateway is blocked as mixed content and falls back to opening in a new tab.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Public Gateway URL</Label>
                <Input value={gateway.public_base_url}
                  onChange={(e) => setGateway(p => ({ ...p, public_base_url: e.target.value }))}
                  placeholder="https://gateway.example.com/guacamole" className="font-mono" />
                {gatewayUrlError && (
                  <p className="text-xs text-destructive">{gatewayUrlError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the gateway URL from backend secrets. Set this when Guacamole sits behind an HTTPS
                  reverse proxy or a different public hostname. An IP address mixed into a domain name (e.g.
                  <span className="font-mono"> 3.6.228.159.example.com</span>) will not resolve.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-6">
                <div>
                  <Label className="text-base font-semibold">Force HTTPS</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rewrite session URLs to https:// so they can be embedded. Enable only after TLS works on the gateway.
                  </p>
                </div>
                <Switch checked={gateway.force_https}
                  onCheckedChange={(v) => setGateway(p => ({ ...p, force_https: v }))} />
              </div>
            </motion.div>
          </TabsContent>

          {/* Capacity & Cost alerts */}
          <TabsContent value="capacity" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-6 max-w-3xl">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Capacity &amp; cost alerts</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Notify admins when active sessions approach limits or estimated spend exceeds a threshold.
                  </p>
                </div>
                <Switch checked={capacity.enabled}
                  onCheckedChange={(v) => setCapacity((p) => ({ ...p, enabled: v }))} />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Max concurrent sessions</Label>
                  <Input type="number" min={1} value={capacity.max_active_sessions}
                    onChange={(e) => setCapacity((p) => ({ ...p, max_active_sessions: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Warn at (% of limit)</Label>
                  <Input type="number" min={10} max={100} value={capacity.warn_at_percent}
                    onChange={(e) => setCapacity((p) => ({ ...p, warn_at_percent: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Daily spend limit (USD)</Label>
                  <Input type="number" min={0} step="1" value={capacity.daily_spend_limit_usd}
                    onChange={(e) => setCapacity((p) => ({ ...p, daily_spend_limit_usd: Number(e.target.value) }))} />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Per-region thresholds</Label>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5"
                    onClick={() => setCapacity((p) => ({
                      ...p,
                      regions: [...p.regions, { region: "eastus", max_active_vms: 10, daily_spend_limit_usd: 25 }],
                    }))}>
                    <Plus className="h-3.5 w-3.5" /> Add region
                  </Button>
                </div>
                {capacity.regions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No region rules yet — platform-wide thresholds above still apply.
                  </p>
                )}
                {capacity.regions.map((rule, idx) => (
                  <div key={idx} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border border-border p-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Region</Label>
                      <Input value={rule.region}
                        onChange={(e) => setCapacity((p) => ({
                          ...p,
                          regions: p.regions.map((r, i) => i === idx ? { ...r, region: e.target.value } : r),
                        }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Max active VMs</Label>
                      <Input type="number" min={1} value={rule.max_active_vms ?? ""}
                        onChange={(e) => setCapacity((p) => ({
                          ...p,
                          regions: p.regions.map((r, i) => i === idx
                            ? { ...r, max_active_vms: e.target.value ? Number(e.target.value) : null } : r),
                        }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Daily spend (USD)</Label>
                      <Input type="number" min={0} value={rule.daily_spend_limit_usd ?? ""}
                        onChange={(e) => setCapacity((p) => ({
                          ...p,
                          regions: p.regions.map((r, i) => i === idx
                            ? { ...r, daily_spend_limit_usd: e.target.value ? Number(e.target.value) : null } : r),
                        }))} />
                    </div>
                    <Button type="button" variant="ghost" size="icon"
                      onClick={() => setCapacity((p) => ({ ...p, regions: p.regions.filter((_, i) => i !== idx) }))}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" className="gap-2" onClick={runAlertCheck} disabled={evaluating}>
                {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Run check now
              </Button>
            </motion.div>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-2xl">
              <Label className="text-base font-semibold">Alert Preferences</Label>
              {[
                { key: 'wafAlerts', title: 'WAF Alerts', desc: 'Notify on blocked requests and security events' },
                { key: 'idleWarnings', title: 'Idle VM Warnings', desc: 'Alert when VMs exceed idle timeout threshold' },
                { key: 'healthEvents', title: 'Health Events', desc: 'Notify on service degradation or outages' },
                { key: 'emailDigest', title: 'Daily Email Digest', desc: 'Receive a daily summary via email' },
                { key: 'slackIntegration', title: 'Slack Integration', desc: 'Send alerts to a Slack channel' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <div>
                    <p className="text-sm text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch
                    checked={notifications[item.key as keyof typeof notifications] as boolean}
                    onCheckedChange={v => setNotifications(prev => ({ ...prev, [item.key]: v }))}
                  />
                </div>
              ))}
              {notifications.slackIntegration && (
                <div className="space-y-2 pt-2">
                  <Label>Webhook URL</Label>
                  <Input value={notifications.webhookUrl}
                    onChange={e => setNotifications(prev => ({ ...prev, webhookUrl: e.target.value }))}
                    placeholder="https://hooks.slack.com/services/..." />
                </div>
              )}
            </motion.div>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="mt-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-2xl">
              <Label className="text-base font-semibold">Security Policies</Label>
              {[
                { key: 'enforceClipboardPolicy', title: 'Enforce Clipboard Policy', desc: 'Globally enforce clipboard restrictions set per lab' },
                { key: 'blockPublicAccess', title: 'Block Public RDP/SSH', desc: 'All VM access must go through Guacamole — no direct public exposure' },
                { key: 'requireMfa', title: 'Require MFA', desc: 'Enforce multi-factor authentication for all users' },
                { key: 'sessionRecording', title: 'Session Recording', desc: 'Record all Guacamole sessions for audit compliance' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <div>
                    <p className="text-sm text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch
                    checked={security[item.key as keyof typeof security] as boolean}
                    onCheckedChange={v => setSecurity(prev => ({ ...prev, [item.key]: v }))}
                  />
                </div>
              ))}
              <div className="border-t border-border pt-4 space-y-2">
                <Label className="text-base font-semibold">Audit Log Retention</Label>
                <p className="text-xs text-muted-foreground mb-2">How long to keep audit logs</p>
                <Select value={String(security.auditRetentionDays)} onValueChange={v => setSecurity(prev => ({ ...prev, auditRetentionDays: Number(v) }))}>
                  <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}