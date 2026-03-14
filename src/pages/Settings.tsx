import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Clock, Server, Bell, Shield, Save, DollarSign, Loader2 } from "lucide-react";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("platform_settings")
      .select("key, value")
      .eq("key", "budget_cap")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const v = data.value as any;
          setBudgetEnabled(v.enabled ?? false);
          setBudgetPeriod(v.period ?? "monthly");
          setBudgetCap(v.amount ?? 100);
        }
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("platform_settings")
        .upsert(
          {
            key: "budget_cap",
            value: { enabled: budgetEnabled, period: budgetPeriod, amount: budgetCap } as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (error) throw error;
      toast({ title: "Settings saved", description: "Platform configuration updated successfully." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
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