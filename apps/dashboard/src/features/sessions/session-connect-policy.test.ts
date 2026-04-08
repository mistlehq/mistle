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
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: "running",
        sandboxConnectable: true,
      }),
    ).toBe(true);
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: "running",
        sandboxConnectable: false,
      }),
    ).toBe(false);
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: "starting",
        sandboxConnectable: false,
      }),
    ).toBe(false);
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: "stopped",
        sandboxConnectable: false,
      }),
    ).toBe(false);
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: "failed",
        sandboxConnectable: false,
      }),
    ).toBe(false);
    expect(
      isSandboxReadyForConnections({
        sandboxStatus: null,
        sandboxConnectable: null,
      }),
    ).toBe(false);
  });

  it("resolves page-level connection readiness and keeps stopped sessions disconnected until resume is requested", () => {
    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: null,
        sandboxStatus: null,
        sandboxConnectable: null,
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
        sandboxConnectable: null,
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
        sandboxConnectable: true,
        isStatusPending: false,
      }),
    ).toEqual({
      canConnect: true,
      reason: "ready",
    });

    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
        sandboxConnectable: false,
        isStatusPending: false,
      }),
    ).toEqual({
      canConnect: false,
      reason: "starting",
    });

    expect(
      resolveSessionConnectionReadiness({
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "stopped",
        sandboxConnectable: false,
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
