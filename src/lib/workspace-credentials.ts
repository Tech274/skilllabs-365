export type CredentialEventType = "issued" | "regenerated" | "copied" | "opened" | "expired";

export const EVENT_LABELS: Record<CredentialEventType, string> = {
  issued: "Issued",
  regenerated: "Regenerated",
  copied: "Copied",
  opened: "Opened",
  expired: "Expired",
};
