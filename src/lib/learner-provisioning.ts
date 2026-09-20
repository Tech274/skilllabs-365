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
  const key = (raw || "").trim();
  if (key === "secure_desktop_retry_exhausted") {
    return {
      title: "We paused reconnecting for a moment",
      detail:
        "Your lab desktop did not come up cleanly after a few tries. This is usually temporary — take a short break, then open the lab again from Labs.",
      tip: "Ops can see the technical details. WhatsApp us if it keeps happening.",
    };
  }
  if (key === "secure_desktop_port_wait") {
    return {
      title: "Your lab is still finishing start-up",
      detail:
        "The machine is on, but it is not accepting connections yet, so we held back the desktop instead of showing a broken screen. Please try Connect again in a minute.",
      tip: "Nothing was lost — your lab machine was not stopped or deleted.",
    };
  }
  if (key === "secure_desktop_login_wall") {
    return {
      title: "Your lab desktop needs another moment",
      detail:
        "We could not confirm a secure desktop session just now, so we stopped instead of showing you a broken screen. Please try again in a moment.",
      tip: "If this repeats, message Ops on WhatsApp with the lab name and time.",
    };
  }
  if (
    key === "secure_desktop_frame_timeout" ||
    key === "secure_desktop_blank_frame" ||
    key === "secure_desktop_frame_error" ||
    key === "secure_desktop_user_reported"
  ) {
    return {
      title: "Your lab desktop needs another moment",
      detail:
        "The secure viewer opened, but the remote session did not settle. You can try again — we will not keep spinning forever.",
      tip: "If this repeats, message Ops on WhatsApp with the lab name and time.",
    };
  }
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
