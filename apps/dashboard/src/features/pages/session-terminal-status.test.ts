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
      const presentation = resolveSessionTerminalStatusPresentation({
        state,
        isRecovering: false,
      });
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(typeof presentation.showSpinner).toBe("boolean");
      expect(sessionTerminalStatusDotClassName(presentation.tone)).toMatch(/^bg-/);
    }
  });

  it("marks only open as live with no spinner", () => {
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.OPEN,
        isRecovering: false,
      }),
    ).toEqual({
      label: "Active",
      showSpinner: false,
      tone: "live",
    });
  });

  it("treats non-open states as inactive", () => {
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.CONNECTING,
        isRecovering: false,
      }),
    ).toEqual({
      label: "Inactive",
      showSpinner: false,
      tone: "offline",
    });
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.OPENING,
        isRecovering: false,
      }),
    ).toEqual({
      label: "Inactive",
      showSpinner: false,
      tone: "offline",
    });
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.CLOSING,
        isRecovering: false,
      }),
    ).toEqual({
      label: "Inactive",
      showSpinner: false,
      tone: "offline",
    });
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.ERROR,
        isRecovering: false,
      }),
    ).toEqual({
      label: "Inactive",
      showSpinner: false,
      tone: "offline",
    });
  });

  it("surfaces reconnecting as an explicit spinner state", () => {
    expect(
      resolveSessionTerminalStatusPresentation({
        state: SandboxPtyStates.CONNECTED,
        isRecovering: true,
      }),
    ).toEqual({
      label: "Reconnecting",
      showSpinner: true,
      tone: "offline",
    });
  });
});
