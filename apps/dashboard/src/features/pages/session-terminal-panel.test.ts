import { describe, expect, it } from "vitest";

import { shouldAutoOpenTerminal } from "./session-terminal-panel.js";

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
