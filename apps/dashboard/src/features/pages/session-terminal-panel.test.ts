import { describe, expect, it } from "vitest";

import {
  resolveTerminalRecoveryMessage,
  shouldAttemptTerminalReconnect,
  shouldAutoOpenTerminal,
  shouldHandleTerminalExit,
  shouldRequestTerminalResume,
} from "./session-terminal-panel.js";

describe("shouldAutoOpenTerminal", () => {
  it("allows auto-open for running sandboxes", () => {
    expect(
      shouldAutoOpenTerminal({
        isVisible: true,
        isConnectionReady: true,
        lifecycleState: "closed",
        hasAttemptedAutoOpen: false,
      }),
    ).toBe(true);
  });

  it("does not auto-open for stopped sandboxes", () => {
    expect(
      shouldAutoOpenTerminal({
        isVisible: true,
        isConnectionReady: false,
        lifecycleState: "closed",
        hasAttemptedAutoOpen: false,
      }),
    ).toBe(false);
  });

  it("does not auto-open while the sandbox is still starting", () => {
    expect(
      shouldAutoOpenTerminal({
        isVisible: true,
        isConnectionReady: false,
        lifecycleState: "closed",
        hasAttemptedAutoOpen: false,
      }),
    ).toBe(false);
  });

  it("does not auto-open after an attempt is already in progress", () => {
    expect(
      shouldAutoOpenTerminal({
        isVisible: true,
        isConnectionReady: true,
        lifecycleState: "opening",
        hasAttemptedAutoOpen: true,
      }),
    ).toBe(false);
  });
});

describe("shouldHandleTerminalExit", () => {
  it("auto-closes when the PTY exits and the exit has not been handled yet", () => {
    expect(
      shouldHandleTerminalExit({
        exitInfo: {
          exitCode: 0,
        },
        hasHandledExit: false,
      }),
    ).toBe(true);
  });

  it("does not auto-close before the PTY exits", () => {
    expect(
      shouldHandleTerminalExit({
        exitInfo: null,
        hasHandledExit: false,
      }),
    ).toBe(false);
  });

  it("does not auto-close the same exit twice", () => {
    expect(
      shouldHandleTerminalExit({
        exitInfo: {
          exitCode: 0,
        },
        hasHandledExit: true,
      }),
    ).toBe(false);
  });
});

describe("shouldRequestTerminalResume", () => {
  it("requests resume only while recovering a visible stopped sandbox", () => {
    expect(
      shouldRequestTerminalResume({
        isRecovering: true,
        isResumingSandbox: false,
        isVisible: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldRequestTerminalResume({
        isRecovering: true,
        isResumingSandbox: true,
        isVisible: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);

    expect(
      shouldRequestTerminalResume({
        isRecovering: false,
        isResumingSandbox: false,
        isVisible: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);
  });
});

describe("shouldAttemptTerminalReconnect", () => {
  it("retries only while a recovery-capable running sandbox is visible", () => {
    expect(
      shouldAttemptTerminalReconnect({
        isRecovering: true,
        isReconnectAttemptInFlight: false,
        isVisible: true,
        lifecycleState: "connected",
        reconnectAttemptCount: 0,
        sandboxStatus: "running",
      }),
    ).toBe(true);

    expect(
      shouldAttemptTerminalReconnect({
        isRecovering: true,
        isReconnectAttemptInFlight: false,
        isVisible: true,
        lifecycleState: "open",
        reconnectAttemptCount: 0,
        sandboxStatus: "running",
      }),
    ).toBe(false);

    expect(
      shouldAttemptTerminalReconnect({
        isRecovering: true,
        isReconnectAttemptInFlight: false,
        isVisible: true,
        lifecycleState: "connected",
        reconnectAttemptCount: 3,
        sandboxStatus: "running",
      }),
    ).toBe(false);
  });
});

describe("resolveTerminalRecoveryMessage", () => {
  const resetInfo = {
    code: "bootstrap_disconnected",
    message: "Sandbox bootstrap tunnel disconnected.",
  } as const;

  it("explains resume-based recovery for stopped sandboxes", () => {
    expect(
      resolveTerminalRecoveryMessage({
        isRecovering: true,
        recoveryErrorMessage: null,
        reconnectAttemptCount: 0,
        resetInfo,
        sandboxStatus: "stopped",
      }),
    ).toBe(
      "Terminal disconnected: Sandbox bootstrap tunnel disconnected. Resuming sandbox to restore the terminal.",
    );
  });

  it("reports reconnect attempts while the sandbox is running", () => {
    expect(
      resolveTerminalRecoveryMessage({
        isRecovering: true,
        recoveryErrorMessage: null,
        reconnectAttemptCount: 2,
        resetInfo,
        sandboxStatus: "running",
      }),
    ).toBe(
      "Terminal disconnected: Sandbox bootstrap tunnel disconnected. Reconnecting terminal (attempt 2 of 3).",
    );
  });

  it("prefers explicit recovery failures over generic reconnect messaging", () => {
    expect(
      resolveTerminalRecoveryMessage({
        isRecovering: true,
        recoveryErrorMessage: "Could not reconnect terminal after 3 attempts.",
        reconnectAttemptCount: 3,
        resetInfo,
        sandboxStatus: "running",
      }),
    ).toBe("Could not reconnect terminal after 3 attempts.");
  });
});
