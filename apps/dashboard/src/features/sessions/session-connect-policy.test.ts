import { describe, expect, it } from "vitest";

import {
  isSessionPageNavigableSandboxStatus,
  isSandboxReadyForConnections,
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "./session-connect-policy.js";

describe("session connect policy", () => {
  it("treats starting, running, and stopped sessions as navigable from the sessions list", () => {
    expect(isSessionPageNavigableSandboxStatus("starting")).toBe(true);
    expect(isSessionPageNavigableSandboxStatus("running")).toBe(true);
    expect(isSessionPageNavigableSandboxStatus("stopped")).toBe(true);
    expect(isSessionPageNavigableSandboxStatus("failed")).toBe(false);
    expect(isSessionPageNavigableSandboxStatus(null)).toBe(false);
  });

  it("treats only running sandboxes as ready for connections", () => {
    expect(isSandboxReadyForConnections("running")).toBe(true);
    expect(isSandboxReadyForConnections("starting")).toBe(false);
    expect(isSandboxReadyForConnections("stopped")).toBe(false);
    expect(isSandboxReadyForConnections("failed")).toBe(false);
    expect(isSandboxReadyForConnections(null)).toBe(false);
  });

  it("resolves page-level connection readiness from sandbox status", () => {
    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: null,
        sandboxStatus: null,
        isStatusPending: false,
      }),
    ).toEqual({
      canConnect: false,
      reason: "missing-session",
    });

    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: null,
        isStatusPending: true,
      }),
    ).toEqual({
      canConnect: false,
      reason: "loading",
    });

    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
        isStatusPending: false,
      }),
    ).toEqual({
      canConnect: true,
      reason: "ready",
    });

    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "stopped",
        isStatusPending: false,
      }),
    ).toEqual({
      canConnect: false,
      reason: "stopped",
    });
  });

  it("auto-connects only when the sandbox is running and no attempt is active", () => {
    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: true,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: false,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: false,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(false);
  });

  it("does not auto-connect when the session already failed or attempted", () => {
    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: true,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: true,
        hasStartError: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: true,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: true,
      }),
    ).toBe(false);

    expect(
      shouldAutoConnectSession({
        sandboxInstanceId: "sbi_123",
        canConnect: false,
        connected: false,
        isStartingSession: false,
        hasAttemptedAutoConnect: false,
        hasStartError: false,
      }),
    ).toBe(false);
  });
});
