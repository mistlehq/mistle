import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveSandboxHeaderStatusUi,
  shouldShowResumeAction,
} from "./session-workbench-view-model.js";

describe("resolveSandboxHeaderStatusUi", () => {
  it.each([
    {
      description: "shows connected when the sandbox is running",
      input: {
        sandboxLifecycleStatus: "running",
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
        sandboxLifecycleStatus: "failed",
      } as const,
      expected: {
        label: "Sandbox failed",
        variant: "destructive",
      },
    },
    {
      description: "shows starting while the sandbox is not yet running",
      input: {
        sandboxLifecycleStatus: "starting",
      } as const,
      expected: {
        label: "Starting sandbox",
        variant: "outline",
      },
    },
    {
      description: "shows resuming while a stopped sandbox resume is pending",
      input: {
        sandboxLifecycleStatus: "resuming",
      } as const,
      expected: {
        label: "Resuming sandbox",
        variant: "outline",
      },
    },
    {
      description: "shows stopped when the sandbox is stopped even if chat state is stale",
      input: {
        sandboxLifecycleStatus: "stopped",
      } as const,
      expected: {
        label: "Sandbox stopped",
        variant: "outline",
      },
    },
    {
      description: "ignores session recovery state while the sandbox is running",
      input: {
        sandboxLifecycleStatus: "running",
      } as const,
      expected: {
        label: "Connected",
        variant: "secondary",
        className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
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
