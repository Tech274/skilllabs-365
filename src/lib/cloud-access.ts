import type { Tables } from "@/integrations/supabase/types";
import { Cloud, Server } from "lucide-react";

export type AccessTemplate = Tables<"access_templates">;
export type TemplateBatch = Tables<"template_batches">;
export type TemplateWorkspaceBatch = Tables<"template_workspace_batches">;
export type TemplateAssignment = Tables<"template_assignments">;
export type AccessSession = Tables<"access_sessions">;
export type AccessSessionEvent = Tables<"access_session_events">;

export type CloudProvider = "azure" | "aws" | "gcp" | "oci" | "ibm" | "alibaba" | "digitalocean" | "other";

export const PROVIDER_META: Record<CloudProvider, { label: string; color: string; bg: string; tagline: string; implemented: boolean }> = {
  aws: {
    label: "AWS",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/30",
    tagline: "Amazon Web Services",
    implemented: true,
  },
  azure: {
    label: "Azure",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/30",
    tagline: "Microsoft Azure",
    implemented: true,
  },
  gcp: {
    label: "GCP",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    tagline: "Google Cloud Platform",
    implemented: false,
  },
  oci: {
    label: "OCI",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    tagline: "Oracle Cloud Infrastructure",
    implemented: false,
  },
  ibm: {
    label: "IBM Cloud",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30",
    tagline: "IBM Cloud",
    implemented: false,
  },
  alibaba: {
    label: "Alibaba",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    tagline: "Alibaba Cloud",
    implemented: false,
  },
  digitalocean: {
    label: "DigitalOcean",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/30",
    tagline: "DigitalOcean",
    implemented: false,
  },
  other: {
    label: "Other",
    color: "text-muted-foreground",
    bg: "bg-muted/40 border-border",
    tagline: "Custom cloud provider",
    implemented: false,
  },
};

export const PROVIDER_ICON: Record<CloudProvider, typeof Cloud> = {
  aws: Server,
  azure: Cloud,
  gcp: Cloud,
  oci: Cloud,
  ibm: Cloud,
  alibaba: Cloud,
  digitalocean: Cloud,
  other: Cloud,
};

export const TEMPLATE_STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  published: "bg-success/10 text-success border-success/30",
  archived: "bg-warning/10 text-warning border-warning/30",
};

export const SESSION_STATUS_STYLE: Record<string, string> = {
  created: "bg-muted text-muted-foreground",
  active: "bg-success/10 text-success",
  expired: "bg-warning/10 text-warning",
  refreshed: "bg-primary/10 text-primary",
  revoked: "bg-destructive/10 text-destructive",
  failed: "bg-destructive/10 text-destructive",
  completed: "bg-muted text-muted-foreground",
};

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatCredit(value: number | null | undefined): string {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
