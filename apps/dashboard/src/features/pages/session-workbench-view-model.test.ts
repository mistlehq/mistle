import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveSessionHeaderStatusUi,
  resolveStoppedSessionMessage,
  shouldShowResumeAction,
} from "./session-workbench-view-model.js";

describe("resolveSessionHeaderStatusUi", () => {
  it.each([
    {
      description: "shows connected when the transport is ready",
      input: {
        sandboxStatus: "running",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
        isRecoveringSession: false,
      } as const,
      expected: {
        label: "Connected",
        variant: "secondary",
        className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      },
    },
    {
      description: "prioritizes sandbox failures over connection state",
      input: {
        sandboxStatus: "failed",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
        isRecoveringSession: false,
      } as const,
      expected: {
        label: "Sandbox failed",
        variant: "destructive",
      },
    },
    {
      description: "shows connecting while the agent is still handshaking",
      input: {
        sandboxStatus: "running",
        agentConnectionState: "opening_agent_stream",
        step: "connecting",
        hasConnectionError: false,
        isRecoveringSession: false,
      } as const,
      expected: {
        label: "Connecting",
        variant: "outline",
      },
    },
    {
      description: "shows resuming while a stopped sandbox resume is pending",
      input: {
        sandboxStatus: "resuming",
        agentConnectionState: "idle",
        step: "securing",
        hasConnectionError: false,
        isRecoveringSession: false,
      } as const,
      expected: {
        label: "Resuming sandbox",
        variant: "outline",
      },
    },
    {
      description:
        "shows connected once the agent channel is ready even if sandbox status is stale",
      input: {
        sandboxStatus: "stopped",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
        isRecoveringSession: false,
      } as const,
      expected: {
        label: "Connected",
        variant: "secondary",
        className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      },
    },
    {
      description: "shows reconnecting while recovering an interrupted running session",
      input: {
        sandboxStatus: "running",
        agentConnectionState: "idle",
        step: "idle",
        hasConnectionError: false,
        isRecoveringSession: true,
      } as const,
      expected: {
        label: "Reconnecting session",
        variant: "outline",
      },
    },
  ])("$description", ({ input, expected }) => {
    expect(resolveSessionHeaderStatusUi(input)).toEqual(expected);
  });
});

describe("hasSessionTopAlert", () => {
  it.each([
    {
      description: "returns false when there are no visible alerts",
      input: {
        hasSandboxStatusError: false,
        lifecycleErrorMessage: null,
        reconnectMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      },
      expected: false,
    },
    {
      description: "returns true for a connection error",
      input: {
        hasSandboxStatusError: false,
        lifecycleErrorMessage: "Could not connect.",
        reconnectMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      },
      expected: true,
    },
    {
      description: "returns true for a stopped-session alert",
      input: {
        hasSandboxStatusError: false,
        lifecycleErrorMessage: null,
        reconnectMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: "This sandbox is stopped.",
      },
      expected: true,
    },
    {
      description: "returns true for a reconnecting-session alert",
      input: {
        hasSandboxStatusError: false,
        lifecycleErrorMessage: null,
        reconnectMessage: "Reconnecting session after stream reset.",
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      },
      expected: true,
    },
  ])("$description", ({ input, expected }) => {
    expect(hasSessionTopAlert(input)).toBe(expected);
  });
});

describe("resolveStoppedSessionMessage", () => {
  it("returns a stopped-session message only for stopped readiness", () => {
    expect(
      resolveStoppedSessionMessage({
        connectionReadinessReason: "stopped",
      }),
    ).toBe("This sandbox is stopped. Resume it to reconnect chat and terminal.");

    expect(
      resolveStoppedSessionMessage({
        connectionReadinessReason: "ready",
      }),
    ).toBeNull();
  });
});

describe("shouldShowResumeAction", () => {
  it("shows the resume action only when manual resume is required", () => {
    expect(
      shouldShowResumeAction({
        requiresManualResume: true,
        isResumingStoppedSandbox: false,
      }),
    ).toBe(true);

    expect(
      shouldShowResumeAction({
        requiresManualResume: false,
        isResumingStoppedSandbox: true,
      }),
    ).toBe(false);

    expect(
      shouldShowResumeAction({
        requiresManualResume: false,
        isResumingStoppedSandbox: false,
      }),
    ).toBe(false);
  });
});
