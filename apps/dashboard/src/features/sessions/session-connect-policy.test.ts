import { describe, expect, it } from "vitest";

import { shouldAutoConnectSession } from "./session-connect-policy.js";

describe("session connect policy", () => {
  it("auto-connects only when the session is ready and no attempt is active", () => {
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
  });
});
