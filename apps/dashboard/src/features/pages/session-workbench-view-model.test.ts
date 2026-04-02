import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveSandboxHeaderStatusUi,
  shouldShowResumeAction,
} from "./session-workbench-view-model.js";

describe("resolveSandboxHeaderStatusUi", () => {
  it.each([
    {
      description:
        "shows connecting when the sandbox is running but the session is not connected yet",
      input: {
        sandboxLifecycleStatus: "running",
        sessionConnectionStatus: "connecting",
      } as const,
      expected: {
        label: "Connecting",
        variant: "outline",
      },
    },
    {
      description: "prioritizes sandbox failures over connection state",
      input: {
        sandboxLifecycleStatus: "failed",
        sessionConnectionStatus: "connected",
      } as const,
      expected: {
        label: "Failed",
        variant: "destructive",
      },
    },
    {
      description: "shows starting while the sandbox is not yet running",
      input: {
        sandboxLifecycleStatus: "starting",
        sessionConnectionStatus: "connecting",
      } as const,
      expected: {
        label: "Starting",
        variant: "outline",
      },
    },
    {
      description: "shows loading while sandbox status is still being retrieved",
      input: {
        sandboxLifecycleStatus: null,
        sessionConnectionStatus: null,
      } as const,
      expected: {
        label: "Loading status",
        variant: "outline",
      },
    },
    {
      description: "shows resuming while a stopped sandbox resume is pending",
      input: {
        sandboxLifecycleStatus: "resuming",
        sessionConnectionStatus: "reconnecting",
      } as const,
      expected: {
        label: "Resuming",
        variant: "outline",
      },
    },
    {
      description: "shows stopped when the sandbox is stopped even if chat state is stale",
      input: {
        sandboxLifecycleStatus: "stopped",
        sessionConnectionStatus: "connected",
      } as const,
      expected: {
        label: "Stopped",
        variant: "outline",
      },
    },
    {
      description: "shows connected when both sandbox and session are connected",
      input: {
        sandboxLifecycleStatus: "running",
        sessionConnectionStatus: "connected",
      } as const,
      expected: {
        label: "Connected",
        variant: "secondary",
        className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      },
    },
    {
      description: "shows reconnecting while the session transport is recovering",
      input: {
        sandboxLifecycleStatus: "running",
        sessionConnectionStatus: "reconnecting",
      } as const,
      expected: {
        label: "Reconnecting",
        variant: "outline",
      },
    },
    {
      description: "shows a session error while the sandbox is still running",
      input: {
        sandboxLifecycleStatus: "running",
        sessionConnectionStatus: "error",
      } as const,
      expected: {
        label: "Session error",
        variant: "destructive",
      },
    },
  ])("$description", ({ input, expected }) => {
    expect(resolveSandboxHeaderStatusUi(input)).toEqual(expected);
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

describe("shouldShowResumeAction", () => {
  it("shows the resume action only when manual resume is required", () => {
    expect(
      shouldShowResumeAction({
        requiresManualResume: true,
      }),
    ).toBe(true);

    expect(
      shouldShowResumeAction({
        requiresManualResume: false,
      }),
    ).toBe(false);

    expect(
      shouldShowResumeAction({
        requiresManualResume: false,
      }),
    ).toBe(false);
  });
});
