import { useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface AzureProbe {
  ok: boolean;
  step: string;
  code?: string;
  message: string;
  setting?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

/**
 * Admin-only probe: verifies AZURE_SUBSCRIPTION_ID exists and that the
 * configured service principal can reach it (and the resource group), so
 * provisioning failures can be diagnosed before launching a lab.
 */
export function AzureSubscriptionTest({
  defaultSubscriptionId = "",
  defaultResourceGroup = "",
}: {
  defaultSubscriptionId?: string;
  defaultResourceGroup?: string;
}) {
  const [subscriptionId, setSubscriptionId] = useState(defaultSubscriptionId);
  const [resourceGroup, setResourceGroup] = useState(defaultResourceGroup);
  const [running, setRunning] = useState(false);
  const [probe, setProbe] = useState<AzureProbe | null>(null);

  const run = async () => {
    setRunning(true);
    setProbe(null);
    const { data, error } = await supabase.functions.invoke<{ probe: AzureProbe }>("cloud-provider-config", {
      method: "POST",
      body: {
        action: "test-azure-subscription",
        subscription_id: subscriptionId || undefined,
        resource_group: resourceGroup || undefined,
      },
    });
    setRunning(false);
    if (error) {
      toast({ title: "Probe failed", description: error.message, variant: "destructive" });
      return;
    }
    setProbe(data?.probe ?? null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Test Azure subscription configuration
        </CardTitle>
        <CardDescription>
          Checks the service principal sign-in, subscription access, and resource group before provisioning.
          Leave the fields empty to test the currently configured secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="azure-sub">Subscription ID</Label>
            <Input
              id="azure-sub"
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              placeholder="Uses AZURE_SUBSCRIPTION_ID secret"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="azure-rg">Resource group</Label>
            <Input
              id="azure-rg"
              value={resourceGroup}
              onChange={(e) => setResourceGroup(e.target.value)}
              placeholder="Uses AZURE_RESOURCE_GROUP secret"
            />
          </div>
        </div>

        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
          Run configuration test
        </Button>

        {probe && (
          <Alert variant={probe.ok ? "default" : "destructive"}>
            {probe.ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            <AlertTitle>
              {probe.ok ? "Azure configuration looks good" : `Failed at step: ${probe.step}${probe.code ? ` (${probe.code})` : ""}`}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="break-words">{probe.message}</p>
              {probe.setting && (
                <p className="text-xs">
                  Setting to update: <span className="font-mono">{probe.setting}</span>
                </p>
              )}
              {probe.suggestion && <p className="text-xs">{probe.suggestion}</p>}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
