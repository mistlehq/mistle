import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { describe, expect, it } from "vitest";

import {
  resolveSessionTerminalStatusPresentation,
  sessionTerminalStatusDotClassName,
} from "./session-terminal-status.js";

describe("resolveSessionTerminalStatusPresentation", () => {
  it("covers every SandboxPtyStates value", () => {
    const states = Object.values(SandboxPtyStates);
    expect(states).toHaveLength(9);

    for (const state of states) {
      const presentation = resolveSessionTerminalStatusPresentation(state);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(typeof presentation.showSpinner).toBe("boolean");
      expect(sessionTerminalStatusDotClassName(presentation.tone)).toMatch(/^bg-/);
    }
  });

  it("marks only open as live with no spinner", () => {
    expect(resolveSessionTerminalStatusPresentation(SandboxPtyStates.OPEN)).toEqual({
      label: "Active",
      showSpinner: false,
      tone: "live",
    });
  });

  it("uses pending + spinner for transitional states", () => {
    expect(resolveSessionTerminalStatusPresentation(SandboxPtyStates.CONNECTING)).toEqual({
      label: "Connecting",
      showSpinner: true,
      tone: "pending",
    });
    expect(resolveSessionTerminalStatusPresentation(SandboxPtyStates.OPENING)).toEqual({
      label: "Opening",
      showSpinner: true,
      tone: "pending",
    });
    expect(resolveSessionTerminalStatusPresentation(SandboxPtyStates.CLOSING)).toEqual({
      label: "Closing",
      showSpinner: true,
      tone: "pending",
    });
  });

  it("marks error distinctly", () => {
    expect(resolveSessionTerminalStatusPresentation(SandboxPtyStates.ERROR)).toEqual({
      label: "Error",
      showSpinner: false,
      tone: "error",
    });
  });
});
