import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BRAND } from "@/lib/brand";

type AuthorizationDetails = {
  client?: { name?: string | null; client_uri?: string | null } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id in the request.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }
      const { data, error: detailsError } = await oauthApi().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const api = oauthApi();
    const { data, error: decisionError } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (decisionError) {
      setBusy(false);
      setError(decisionError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect was returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "this application";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background p-4">
      <BrandMark size="md" showTagline />
      <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur">
        {error ? (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                <TriangleAlert className="w-6 h-6 text-destructive" />
              </div>
              <CardTitle className="text-xl">Authorization request failed</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground text-center">
              Close this window and start the connection again from your agent.
            </CardContent>
          </>
        ) : !details ? (
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading authorization request…</span>
          </CardContent>
        ) : (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-xl">Connect {clientName}</CardTitle>
              <CardDescription>
                {clientName} is requesting access to {BRAND.name} Labs as you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Once approved it can, on your behalf:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Read your lab templates, lab VMs and session history</li>
                <li>Read provisioning timelines and per-lab cost snapshots</li>
                <li>Stop or delete lab VMs you own</li>
              </ul>
              <p>It only ever sees data your own account can access.</p>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                Deny
              </Button>
              <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                {busy ? "Working…" : "Approve"}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </main>
  );
}
