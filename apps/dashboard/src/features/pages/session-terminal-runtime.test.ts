import { describe, expect, it } from "vitest";

import {
  buildTerminalPtyOpenInput,
  reduceTerminalRecoveryState,
  shouldAttemptTerminalReconnect,
  shouldAutoOpenTerminal,
  shouldHandleTerminalExit,
  shouldObserveTerminalReset,
} from "./session-terminal-runtime.js";

const ResetInfo = {
  code: "bootstrap_disconnected",
  message: "Sandbox bootstrap tunnel disconnected.",
} as const;

describe("buildTerminalPtyOpenInput", () => {
  it("includes the selected repository path as cwd", () => {
    expect(
      buildTerminalPtyOpenInput({
        cwd: "/root/acme/repo-2",
        sandboxInstanceId: "sandbox_123",
      }),
    ).toEqual({
      cols: 120,
      cwd: "/root/acme/repo-2",
      ptySessionId: "terminal",
      rows: 20,
      sandboxInstanceId: "sandbox_123",
    });
  });

  it("includes the resolved workbench cwd", () => {
    expect(
      buildTerminalPtyOpenInput({
        cwd: "/root",
        sandboxInstanceId: "sandbox_123",
      }),
    ).toEqual({
      cols: 120,
      cwd: "/root",
      ptySessionId: "terminal",
      rows: 20,
      sandboxInstanceId: "sandbox_123",
    });
  });

  it("uses a custom PTY session id when one is provided", () => {
    expect(
      buildTerminalPtyOpenInput({
        cwd: "/root/acme/repo-2",
        ptySessionId: "terminal-2",
        sandboxInstanceId: "sandbox_123",
      }),
    ).toEqual({
      cols: 120,
      cwd: "/root/acme/repo-2",
      ptySessionId: "terminal-2",
      rows: 20,
      sandboxInstanceId: "sandbox_123",
    });
  });
});

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

describe("shouldObserveTerminalReset", () => {
  it("does not observe resets while the terminal is hidden", () => {
    expect(
      shouldObserveTerminalReset({
        isTerminalVisible: false,
        lastHandledReset: null,
        nextReset: ResetInfo,
      }),
    ).toBe(false);
  });

  it("does not observe an absent reset", () => {
    expect(
      shouldObserveTerminalReset({
        isTerminalVisible: true,
        lastHandledReset: null,
        nextReset: null,
      }),
    ).toBe(false);
  });

  it("does not observe the same reset twice", () => {
    expect(
      shouldObserveTerminalReset({
        isTerminalVisible: true,
        lastHandledReset: ResetInfo,
        nextReset: ResetInfo,
      }),
    ).toBe(false);
  });

  it("observes a fresh visible reset", () => {
    expect(
      shouldObserveTerminalReset({
        isTerminalVisible: true,
        lastHandledReset: null,
        nextReset: ResetInfo,
      }),
    ).toBe(true);
  });
});

describe("reduceTerminalRecoveryState", () => {
  it("starts a fresh recovery cycle when a reset is seen", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "idle",
        },
        {
          type: "reset_seen",
          resetInfo: ResetInfo,
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 0,
      command: "none",
      failure: null,
    });
  });

  it("fails recovery when the sandbox stops", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 0,
          command: "none",
          failure: null,
        },
        {
          type: "sync_observed",
          isReconnectAttemptInFlight: false,
          lifecycleState: "closed",
          sandboxStatus: "stopped",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 0,
      command: "none",
      failure: "sandbox_stopped",
    });
  });

  it("requests terminal reopen only for a running recovery cycle", () => {
    const recovery = reduceTerminalRecoveryState(
      {
        kind: "recovering",
        attemptCount: 0,
        command: "none",
        failure: null,
      },
      {
        type: "sync_observed",
        isReconnectAttemptInFlight: false,
        lifecycleState: "connected",
        sandboxStatus: "running",
      },
    );

    expect(shouldAttemptTerminalReconnect({ recovery })).toBe(true);
  });

  it("increments reconnect attempts when a reopen starts", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 0,
          command: "reopen",
          failure: null,
        },
        {
          type: "reopen_requested",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 1,
      command: "none",
      failure: null,
    });
  });
});
