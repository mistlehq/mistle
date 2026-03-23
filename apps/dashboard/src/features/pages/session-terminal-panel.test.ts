import { describe, expect, it } from "vitest";

import { shouldAutoCloseTerminalOnExit, shouldAutoOpenTerminal } from "./session-terminal-panel.js";

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

describe("shouldAutoCloseTerminalOnExit", () => {
  it("auto-closes when the PTY exits and the exit has not been handled yet", () => {
    expect(
      shouldAutoCloseTerminalOnExit({
        exitInfo: {
          exitCode: 0,
        },
        hasHandledExit: false,
      }),
    ).toBe(true);
  });

  it("does not auto-close before the PTY exits", () => {
    expect(
      shouldAutoCloseTerminalOnExit({
        exitInfo: null,
        hasHandledExit: false,
      }),
    ).toBe(false);
  });

  it("does not auto-close the same exit twice", () => {
    expect(
      shouldAutoCloseTerminalOnExit({
        exitInfo: {
          exitCode: 0,
        },
        hasHandledExit: true,
      }),
    ).toBe(false);
  });
});
