import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUAC_IFRAME_ALLOW,
  bindGuacamoleFocus,
  defaultTypingAssist,
  focusGuacamoleFrame,
  shouldRefocusGuacamoleFrame,
  showTypingGate,
} from "./guac-keyboard";

function iframeWithContentWindowSpy(): { iframe: HTMLIFrameElement; contentFocus: ReturnType<typeof vi.fn> } {
  const iframe = document.createElement("iframe");
  const contentFocus = vi.fn();
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: { focus: contentFocus },
  });
  document.body.appendChild(iframe);
  return { iframe, contentFocus };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("defaultTypingAssist", () => {
  it("is on for SSH and RDP (Ubuntu and Windows share one path)", () => {
    expect(defaultTypingAssist("SSH")).toBe(true);
    expect(defaultTypingAssist("ssh")).toBe(true);
    expect(defaultTypingAssist("RDP")).toBe(true);
    expect(defaultTypingAssist("rdp")).toBe(true);
  });

  it("stays off until a protocol is known", () => {
    expect(defaultTypingAssist("")).toBe(false);
    expect(defaultTypingAssist("  ")).toBe(false);
    expect(defaultTypingAssist(null)).toBe(false);
  });
});

describe("shouldRefocusGuacamoleFrame", () => {
  it("refocuses from body and from toolbar buttons", () => {
    const iframe = document.createElement("iframe");
    const button = document.createElement("button");
    expect(shouldRefocusGuacamoleFrame({ active: document.body, iframe })).toBe(true);
    expect(shouldRefocusGuacamoleFrame({ active: button, target: button, iframe })).toBe(true);
    expect(shouldRefocusGuacamoleFrame({ active: null, iframe })).toBe(true);
  });

  it("does not churn focus when the iframe is already the target", () => {
    const iframe = document.createElement("iframe");
    expect(shouldRefocusGuacamoleFrame({ active: iframe, iframe })).toBe(false);
    expect(shouldRefocusGuacamoleFrame({ active: document.body, target: iframe, iframe })).toBe(false);
  });

  it("leaves text fields and keep-focus panels alone", () => {
    const iframe = document.createElement("iframe");
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const panel = document.createElement("div");
    panel.setAttribute("data-guac-keep-focus", "");
    const panelButton = document.createElement("button");
    panel.appendChild(panelButton);
    expect(shouldRefocusGuacamoleFrame({ active: input, iframe })).toBe(false);
    expect(shouldRefocusGuacamoleFrame({ active: area, iframe })).toBe(false);
    expect(shouldRefocusGuacamoleFrame({ active: panelButton, target: panelButton, iframe })).toBe(false);
    expect(shouldRefocusGuacamoleFrame({ active: document.body, target: panel, iframe })).toBe(false);
  });

  it("treats checkboxes as non-text so the Typing switch can return focus", () => {
    const iframe = document.createElement("iframe");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(shouldRefocusGuacamoleFrame({ active: checkbox, target: checkbox, iframe })).toBe(true);
  });
});

describe("focusGuacamoleFrame", () => {
  it("focuses the iframe element and never contentWindow", () => {
    const { iframe, contentFocus } = iframeWithContentWindowSpy();
    const focus = vi.spyOn(iframe, "focus");
    expect(focusGuacamoleFrame(iframe)).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(contentFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(iframe);
  });

  it("no-ops without an iframe", () => {
    expect(focusGuacamoleFrame(null)).toBe(false);
  });
});

describe("showTypingGate", () => {
  const ready = {
    typingAssist: true,
    connected: true,
    desktopConfirmed: true,
    awaitingDesktop: false,
    armed: false,
    hasSessionUrl: true,
  };

  it("shows for a confirmed SSH or RDP desktop until the learner arms typing", () => {
    expect(showTypingGate(ready)).toBe(true);
    expect(showTypingGate({ ...ready, armed: true })).toBe(false);
    expect(showTypingGate({ ...ready, typingAssist: false })).toBe(false);
  });

  it("stays hidden during connect so it cannot cover the tunnel iframe", () => {
    expect(showTypingGate({ ...ready, connected: false })).toBe(false);
    expect(showTypingGate({ ...ready, desktopConfirmed: false })).toBe(false);
    expect(showTypingGate({ ...ready, awaitingDesktop: true })).toBe(false);
    expect(showTypingGate({ ...ready, hasSessionUrl: false })).toBe(false);
  });
});

describe("bindGuacamoleFocus", () => {
  it("arms typing and focuses the iframe on keydown for an SSH session shell", () => {
    const { iframe, contentFocus } = iframeWithContentWindowSpy();
    const onArm = vi.fn();
    const stop = bindGuacamoleFocus({
      document,
      window,
      getIframe: () => iframe,
      onArm,
    });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(document.activeElement).toBe(iframe);
    expect(contentFocus).not.toHaveBeenCalled();
    expect(onArm).toHaveBeenCalledTimes(1);
    stop();
    onArm.mockClear();
    document.body.focus();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(onArm).not.toHaveBeenCalled();
  });

  it("restores the iframe after a toolbar click and keeps workbench focus", () => {
    const { iframe, contentFocus } = iframeWithContentWindowSpy();
    const stop = bindGuacamoleFocus({
      document,
      window,
      getIframe: () => iframe,
    });

    const toolbar = document.createElement("button");
    toolbar.textContent = "Reconnect";
    document.body.appendChild(toolbar);
    toolbar.focus();
    toolbar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(iframe);
    expect(contentFocus).not.toHaveBeenCalled();

    const panel = document.createElement("div");
    panel.setAttribute("data-guac-keep-focus", "");
    const note = document.createElement("textarea");
    panel.appendChild(note);
    document.body.appendChild(panel);
    note.focus();
    note.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(document.activeElement).toBe(note);
    expect(contentFocus).not.toHaveBeenCalled();
    stop();
  });

  it("refocuses on window focus without counting that as the typing gesture", () => {
    const { iframe } = iframeWithContentWindowSpy();
    const onArm = vi.fn();
    const stop = bindGuacamoleFocus({
      document,
      window,
      getIframe: () => iframe,
      onArm,
    });
    document.body.focus();
    window.dispatchEvent(new FocusEvent("focus"));
    expect(document.activeElement).toBe(iframe);
    expect(onArm).not.toHaveBeenCalled();
    stop();
  });
});

describe("GUAC_IFRAME_ALLOW", () => {
  it("keeps clipboard and adds keyboard-map for the embedded client", () => {
    expect(GUAC_IFRAME_ALLOW).toContain("clipboard-read");
    expect(GUAC_IFRAME_ALLOW).toContain("clipboard-write");
    expect(GUAC_IFRAME_ALLOW).toContain("keyboard-map");
  });
});
