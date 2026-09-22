import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Info, Star } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceCredentialActivity } from "@/components/WorkspaceCredentialActivity";
import {
  buildWorkspaceEmail, DEFAULT_WORKSPACE_EMAIL_DOMAIN, isRealWorkspaceCredential, workspaceIcon,
} from "@/lib/workspaces";
import type { CredentialEventType } from "@/lib/workspace-credentials";

import type { Tables } from "@/integrations/supabase/types";

export type Workspace = Tables<"platform_applications">;

/** Reads the admin-configured workspace email domain (falls back to the default). */
export function useWorkspaceEmailDomain() {
  const [domain, setDomain] = useState(DEFAULT_WORKSPACE_EMAIL_DOMAIN);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "workspace_email_domain")
      .maybeSingle()
      .then(({ data }) => {
        const value = typeof data?.value === "string" ? data.value : null;
        if (!cancelled && value) setDomain(value);
      });
    return () => { cancelled = true; };
  }, []);
  return domain;
}

async function recordLaunch(params: {
  userId: string;
  workspace: Workspace;
  url: string;
  launchType: "direct" | "trial_signup";
  generatedEmail: string | null;
}) {
  const { userId, workspace, url, launchType, generatedEmail } = params;
  await supabase.from("platform_application_launch_events").insert({
    user_id: userId,
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    launch_url: url,
    launch_type: launchType,
    generated_email: generatedEmail,
  });
  if (generatedEmail) {
    // The edge function owns trial identity records so the mailbox alias can be
    // provisioned (Microsoft 365 / AWS SES) and its outcome recorded for audits.
    const { error } = await supabase.functions.invoke("workspace-alias", {
      body: { workspace_id: workspace.id, email: generatedEmail },
    });
    if (error) {
      toast({
        title: "Workspace email not provisioned",
        description: "The alias was generated but automatic mailbox provisioning failed. An admin has been notified.",
        variant: "destructive",
      });
    }
  }
}

/**
 * Exposes the login IDs configured on the workspace template and audits
 * copy / open actions. No credentials are generated for the learner.
 */
function useWorkspaceCredentials(workspace: Workspace | null) {
  const { user } = useAuth();
  const [activityKey, setActivityKey] = useState(0);

  const logEvent = useCallback(async (
    eventType: CredentialEventType,
    credentialId: string | null,
    detail: Record<string, unknown> = {},
  ) => {
    if (!user || !workspace) return;
    await supabase.from("workspace_credential_events").insert({
      user_id: user.id,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      credential_id: credentialId,
      event_type: eventType,
      detail: detail as Tables<"workspace_credential_events">["detail"],
    });
    setActivityKey((k) => k + 1);
  }, [user, workspace]);

  // Catalogue defaults are generic wording, not real logins — never present
  // them to learners as copyable credentials.
  const rawUsername = workspace?.username_placeholder ?? "";
  const rawPassword = workspace?.password_placeholder ?? "";

  return {
    username: isRealWorkspaceCredential(rawUsername) ? rawUsername : "",
    password: isRealWorkspaceCredential(rawPassword) ? rawPassword : "",
    activityKey,
    logEvent,
  };
}


/** Single labelled value with a copy-to-clipboard button. */
function CopyRow({ label, value, disabled, onCopied }: {
  label: string;
  value: string;
  disabled?: boolean;
  onCopied?: (label: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (disabled) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    onCopied?.(label);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 truncate text-sm font-mono ${disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {value}
        </code>
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={copy} disabled={disabled} aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function useWorkspaceLauncher(domain: string) {
  const { user } = useAuth();
  const [active, setActive] = useState<Workspace | null>(null);

  const learnerIdentity = user?.email ?? user?.id ?? "learner";
  const creds = useWorkspaceCredentials(active);

  const open = useCallback((workspace: Workspace) => {
    setActive(workspace);
  }, []);

  const launch = useCallback(async (workspace: Workspace) => {
    const url = workspace.launch_url;
    const email = workspace.workspace_email_enabled
      ? buildWorkspaceEmail(learnerIdentity, workspace.slug, domain)
      : null;
    window.open(url, "_blank", "noopener,noreferrer");
    await creds.logEvent("opened", null, { launch_url: url });
    if (user) {
      await recordLaunch({
        userId: user.id, workspace, url,
        launchType: "direct", generatedEmail: email,
      });
    }
    setActive(null);
  }, [domain, learnerIdentity, user, creds]);

  const dialog = (
    <WorkspaceCredentialsDialog
      workspace={active}
      email={active?.workspace_email_enabled
        ? buildWorkspaceEmail(learnerIdentity, active.slug, domain)
        : null}
      credentials={creds}
      onOpenChange={(next) => { if (!next) setActive(null); }}
      onLaunch={launch}
    />
  );

  return { open, dialog };
}

function WorkspaceCredentialsDialog({ workspace, email, credentials, onOpenChange, onLaunch }: {
  workspace: Workspace | null;
  email: string | null;
  credentials: ReturnType<typeof useWorkspaceCredentials>;
  onOpenChange: (open: boolean) => void;
  onLaunch: (workspace: Workspace) => void;
}) {
  const { username, password, activityKey, logEvent } = credentials;
  const hasCredentials = Boolean(username || password);

  const onCopied = (field: string) => void logEvent("copied", null, { field });

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{workspace?.name}</DialogTitle>
          <DialogDescription>
            {hasCredentials
              ? "Use the login IDs assigned in this workspace template — no separate signup needed."
              : "No login IDs have been assigned to this workspace template yet. Contact your administrator."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {workspace?.description && (
            <p className="text-xs text-muted-foreground">{workspace.description}</p>
          )}
          {email && <CopyRow label="Workspace email" value={email} onCopied={onCopied} />}
          <CopyRow
            label="Username"
            value={username}
            disabled={!username}
            onCopied={onCopied}
          />
          <CopyRow
            label="Password"
            value={password}
            disabled={!password}
            onCopied={onCopied}
          />
          {workspace?.access_note && (
            <p className="text-[11px] text-warning">{workspace.access_note}</p>
          )}
          {workspace?.login_binding_note && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{workspace.login_binding_note}</span>
            </p>
          )}

          {workspace && (
            <div className="pt-1">
              <WorkspaceCredentialActivity key={activityKey} workspaceId={workspace.id} limit={6} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => workspace && onLaunch(workspace)}>
            <ExternalLink className="h-4 w-4 mr-2" /> Open Workspace
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceTile({ workspace, onOpen, compact, isFavorite, onToggleFavorite }: {
  workspace: Workspace;
  onOpen: (workspace: Workspace) => void;
  compact?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (workspaceId: string) => void;
}) {
  const Icon = useMemo(() => workspaceIcon(workspace.category), [workspace.category]);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${workspace.name} credentials`}
      onClick={() => onOpen(workspace)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(workspace); }
      }}
      className="rounded-md p-3 flex flex-col gap-2 cursor-pointer hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
    >
      <div className="flex items-start gap-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
          style={{ backgroundColor: `${workspace.icon_color}1f`, color: workspace.icon_color }}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{workspace.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{workspace.category}</p>
        </div>
        {onToggleFavorite && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={isFavorite ? `Remove ${workspace.name} from favorites` : `Add ${workspace.name} to favorites`}
            aria-pressed={Boolean(isFavorite)}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(workspace.id); }}
          >
            <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-warning text-warning" : "text-muted-foreground"}`} />
          </Button>
        )}
        {workspace.status === "inactive" && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
      </div>

      {!compact && (
        <>
          <p className="text-xs text-muted-foreground line-clamp-2">{workspace.description}</p>
          {workspace.access_note && (
            <p className="text-[11px] text-warning">{workspace.access_note}</p>
          )}
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p className="truncate">Login IDs assigned in this template</p>
          </div>
        </>
      )}
      <Button
        size="sm"
        className="mt-auto h-8 text-xs"
        onClick={(e) => { e.stopPropagation(); onOpen(workspace); }}
      >
        View Login
        <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
      </Button>
    </Card>
  );
}
