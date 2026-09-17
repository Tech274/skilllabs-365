/**
 * Learner-facing provisioning copy helpers.
 * Keeps IPs, Guacamole/NSG/security-group jargon, and raw stage dumps out of student UI.
 */

const TECHNICAL_LEAK =
  /\b(?:\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?|Guacamole|NSG|security group|ARM|subnet|correlation|instance[-_ ]?id|i-[0-9a-f]+|vmss|provider-preflight|reachability-precheck|Timed out after \d+ms)\b/i;

/** Strip or replace messages that leak infra detail to learners. */
export function sanitizeLearnerMessage(raw: string | null | undefined): string {
  if (!raw?.trim()) {
    return "We're still preparing your lab environment.";
  }
  if (TECHNICAL_LEAK.test(raw) || raw.length > 180) {
    return "We're having trouble finishing your lab setup. Our team has been notified — you can try again in a moment.";
  }
  return raw;
}

export function learnerFailureCopy(raw?: string | null): {
  title: string;
  detail: string;
  tip: string;
} {
  const detail = sanitizeLearnerMessage(raw);
  return {
    title: "We couldn't open your lab just yet",
    detail,
    tip: "This is usually temporary while the lab finishes booting. Try again, or message Ops on WhatsApp if it keeps happening.",
  };
}

export const LEARNER_PROVISION_TIPS = [
  "Most labs are ready in about one to two minutes.",
  "Keep this tab open — we'll connect automatically when ready.",
  "You can cancel and relaunch if you need to step away.",
] as const;
