import { describe, expect, it } from "vitest";

import type { TerminalRecoveryState } from "./session-terminal-panel.js";
import {
  reduceTerminalRecoveryState,
  resolveTerminalRecoveryMessage,
  shouldAttemptTerminalReconnect,
  shouldAutoOpenTerminal,
  shouldHandleTerminalExit,
} from "./session-terminal-panel.js";

const ResetInfo = {
  code: "bootstrap_disconnected",
  message: "Sandbox bootstrap tunnel disconnected.",
} as const;

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
      errorMessage: null,
      resetInfo: ResetInfo,
    });
  });

  it("fails recovery when the sandbox stops", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 0,
          command: "none",
          errorMessage: null,
          resetInfo: ResetInfo,
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
      errorMessage: "Terminal disconnected and the sandbox stopped.",
      resetInfo: ResetInfo,
    });
  });

  it("requests terminal reopen only for a running recovery cycle", () => {
    const recovery = reduceTerminalRecoveryState(
      {
        kind: "recovering",
        attemptCount: 0,
        command: "none",
        errorMessage: null,
        resetInfo: ResetInfo,
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
          errorMessage: null,
          resetInfo: ResetInfo,
        },
        {
          type: "reopen_requested",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 1,
      command: "none",
      errorMessage: null,
      resetInfo: ResetInfo,
    });
  });

  it("clears recovery once the PTY is open again", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 1,
          command: "none",
          errorMessage: null,
          resetInfo: ResetInfo,
        },
        {
          type: "sync_observed",
          isReconnectAttemptInFlight: false,
          lifecycleState: "open",
          sandboxStatus: "running",
        },
      ),
    ).toEqual({
      kind: "idle",
    });
  });

  it("records an explicit terminal failure when the sandbox fails", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 0,
          command: "none",
          errorMessage: null,
          resetInfo: ResetInfo,
        },
        {
          type: "sync_observed",
          isReconnectAttemptInFlight: false,
          lifecycleState: "closed",
          sandboxStatus: "failed",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 0,
      command: "none",
      errorMessage: "Terminal disconnected and the sandbox failed.",
      resetInfo: ResetInfo,
    });
  });

  it("fails recovery after the reconnect attempt budget is exhausted", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 3,
          command: "none",
          errorMessage: null,
          resetInfo: ResetInfo,
        },
        {
          type: "sync_observed",
          isReconnectAttemptInFlight: false,
          lifecycleState: "closed",
          sandboxStatus: "running",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 3,
      command: "none",
      errorMessage: "Could not reconnect terminal after 3 attempts.",
      resetInfo: ResetInfo,
    });
  });

  it("records terminal reopen failures without issuing another command", () => {
    expect(
      reduceTerminalRecoveryState(
        {
          kind: "recovering",
          attemptCount: 1,
          command: "none",
          errorMessage: null,
          resetInfo: ResetInfo,
        },
        {
          type: "reopen_failed",
          message: "Could not reopen sandbox terminal.",
        },
      ),
    ).toEqual({
      kind: "recovering",
      attemptCount: 1,
      command: "none",
      errorMessage: "Could not reopen sandbox terminal.",
      resetInfo: ResetInfo,
    });
  });
});

describe("resolveTerminalRecoveryMessage", () => {
  function createRecoveringState(
    overrides: Partial<Extract<TerminalRecoveryState, { kind: "recovering" }>> = {},
  ): TerminalRecoveryState {
    return {
      kind: "recovering",
      attemptCount: 0,
      command: "none",
      errorMessage: null,
      resetInfo: ResetInfo,
      ...overrides,
    };
  }

  it("explains that stopped sandboxes cannot reconnect the terminal", () => {
    expect(
      resolveTerminalRecoveryMessage({
        recovery: createRecoveringState(),
        sandboxStatus: "stopped",
      }),
    ).toBe(
      "Terminal disconnected: Sandbox bootstrap tunnel disconnected. The sandbox stopped and the terminal cannot reconnect.",
    );
  });

  it("reports reconnect attempts while the sandbox is running", () => {
    expect(
      resolveTerminalRecoveryMessage({
        recovery: createRecoveringState({
          attemptCount: 2,
        }),
        sandboxStatus: "running",
      }),
    ).toBe(
      "Terminal disconnected: Sandbox bootstrap tunnel disconnected. Reconnecting terminal (attempt 2 of 3).",
    );
  });

  it("prefers explicit recovery failures over generic reconnect messaging", () => {
    expect(
      resolveTerminalRecoveryMessage({
        recovery: createRecoveringState({
          attemptCount: 3,
          errorMessage: "Could not reconnect terminal after 3 attempts.",
        }),
        sandboxStatus: "running",
      }),
    ).toBe("Could not reconnect terminal after 3 attempts.");
  });
});
