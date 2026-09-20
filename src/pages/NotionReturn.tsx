import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/** Landing page for the Notion consent popup — finishes and closes itself. */
export default function NotionReturn() {
  const [message, setMessage] = useState("Finishing the Notion connection\u2026");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notify = (type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed", reason?: string) => {
      window.opener?.postMessage({ type, connectorId: "notion", reason }, window.location.origin);
    };

    if (params.get("success") !== "true") {
      const reason = params.get("error") ?? "Notion did not complete the connection.";
      setMessage(reason);
      notify("appUserConnectorOAuthFailed", reason);
      window.close();
      return;
    }

    const code = params.get("code");
    if (!code) {
      const reason = params.get("offline_access_allowed") === "false"
        ? "This Notion connection cannot be used yet: an administrator must enable offline access on the workspace Notion client."
        : "Notion finished without a connection code.";
      setMessage(reason);
      notify("appUserConnectorOAuthFailed", reason);
      if (params.get("offline_access_allowed") !== "false") window.close();
      return;
    }

    void supabase.functions
      .invoke("app-user-oauth-complete", { body: { code } })
      .then(({ error }) => {
        if (error) throw error;
        notify("appUserConnectorOAuthComplete");
        window.close();
      })
      .catch(() => {
        const reason = "We could not finish the Notion connection.";
        setMessage(reason);
        notify("appUserConnectorOAuthFailed", reason);
        window.close();
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="flex max-w-md items-start gap-3 text-sm text-muted-foreground">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        <p>{message}</p>
      </div>
    </div>
  );
}
