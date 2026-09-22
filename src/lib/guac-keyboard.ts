/**
 * Parent-page keyboard handoff for a cross-origin Apache Guacamole iframe.
 *
 * Guacamole captures keys on the iframe document and on its hidden InputSink
 * textarea (indexController). The Hub cannot script that document. Apache's
 * iframe FAQ states that clicking inside the frame does not return keyboard
 * focus, for SSH and RDP alike. The supported workaround is to call
 * `iframe.focus()` from the parent on click and keydown when the learner is
 * not in another text control.
 *
 * `contentWindow.focus()` is intentionally never used. It is cross-origin
 * fragile and blurs the InputSink without the click/select that sink needs,
 * so keys never arrive. Delayed timers are also omitted: they run outside a
 * user gesture, so browsers drop the focus call or steal it back from Guacamole.
 */

/** Feature policy delegated to the Guacamole origin (clipboard + keyboard lock). */
export const GUAC_IFRAME_ALLOW = "clipboard-read; clipboard-write; keyboard-map";

/** Parent controls that must keep focus (workbench, dialogs). */
export const GUAC_KEEP_FOCUS_ATTR = "data-guac-keep-focus";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "hidden",
  "image",
  "range",
  "color",
]);

/**
 * Typing assist defaults on for every Guacamole protocol. SSH must not be
 * excluded: the iframe focus bug is not Windows-specific.
 */
export function defaultTypingAssist(protocol: string | null | undefined): boolean {
  return Boolean(protocol && protocol.trim());
}

export function isTextEntryElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function keepsParentFocus(el: Element | null | undefined): boolean {
  if (!el || typeof el.closest !== "function") return false;
  if (isTextEntryElement(el)) return true;
  return Boolean(el.closest(`[${GUAC_KEEP_FOCUS_ATTR}]`));
}

export function shouldRefocusGuacamoleFrame(opts: {
  active: Element | null | undefined;
  target?: Element | null;
  iframe: HTMLIFrameElement | null;
}): boolean {
  const { active, target, iframe } = opts;
  if (!iframe) return false;
  // Already the frame. Focusing again churns Guacamole's InputSink.
  if (active === iframe || target === iframe) return false;
  if (keepsParentFocus(active) || keepsParentFocus(target ?? null)) return false;
  return true;
}

/**
 * Focus the iframe element only. Returns false when there is no frame.
 * Does not call `contentWindow.focus()`.
 */
export function focusGuacamoleFrame(iframe: HTMLIFrameElement | null): boolean {
  if (!iframe) return false;
  try {
    iframe.focus({ preventScroll: true });
    return true;
  } catch {
    try {
      iframe.focus();
      return true;
    } catch {
      return false;
    }
  }
}

/** One-shot hint. Hidden while the tunnel is still covered, so it cannot block Connect. */
export function showTypingGate(opts: {
  typingAssist: boolean;
  connected: boolean;
  desktopConfirmed: boolean;
  awaitingDesktop: boolean;
  armed: boolean;
  hasSessionUrl: boolean;
}): boolean {
  return (
    opts.typingAssist &&
    opts.connected &&
    opts.desktopConfirmed &&
    !opts.awaitingDesktop &&
    !opts.armed &&
    opts.hasSessionUrl
  );
}

/**
 * Parent click/keydown/window-focus → iframe.focus() for both SSH and RDP.
 * `onArm` runs only for click and keydown (real user gestures), not tab focus.
 */
export function bindGuacamoleFocus(opts: {
  document: Document;
  window: Window;
  getIframe: () => HTMLIFrameElement | null;
  onArm?: () => void;
}): () => void {
  const onParentIntent = (event: Event) => {
    const frame = opts.getIframe();
    const target = event.target instanceof Element ? event.target : null;
    if (!shouldRefocusGuacamoleFrame({
      active: opts.document.activeElement,
      target,
      iframe: frame,
    })) return;
    if (!focusGuacamoleFrame(frame)) return;
    if (event.type === "click" || event.type === "keydown") opts.onArm?.();
  };

  opts.document.addEventListener("click", onParentIntent);
  opts.document.addEventListener("keydown", onParentIntent);
  opts.window.addEventListener("focus", onParentIntent);
  return () => {
    opts.document.removeEventListener("click", onParentIntent);
    opts.document.removeEventListener("keydown", onParentIntent);
    opts.window.removeEventListener("focus", onParentIntent);
  };
}
