import { describe, expect, it } from "vitest";

import { isConnectableSandboxStatus, shouldAutoConnectSession } from "./session-connect-policy.js";

describe("session connect policy", () => {
  it("treats starting, running, and stopped sessions as connectable", () => {
    expect(isConnectableSandboxStatus("starting")).toBe(true);
    expect(isConnectableSandboxStatus("running")).toBe(true);
    expect(isConnectableSandboxStatus("stopped")).toBe(true);
    expect(isConnectableSandboxStatus("failed")).toBe(false);
    expect(isConnectableSandboxStatus(null)).toBe(false);
  });

  it("auto-connects when the session is connectable and no attempt is active", () => {
    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "stopped",
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(true);
  });

  it("does not auto-connect when the session already failed or attempted", () => {
    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: true,
        hasStartError: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: true,
      }),
    ).toBe(false);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "failed",
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(false);
  });
});
