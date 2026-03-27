import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveChatComposerAction,
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
      } as const,
      expected: {
        label: "Connected",
        variant: "secondary",
        className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
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
        sandboxFailureMessage: null,
        stoppedSessionMessage: "This sandbox is stopped.",
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

describe("resolveChatComposerAction", () => {
  it("starts a turn with trimmed text when no turn is active", () => {
    expect(
      resolveChatComposerAction({
        composerText: "  hello world  ",
        hasActiveTurn: false,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "start_turn",
      prompt: "hello world",
      shouldClearComposer: true,
    });
  });

  it("interrupts an active turn when the composer is empty", () => {
    expect(
      resolveChatComposerAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "interrupt_turn",
      shouldClearComposer: false,
    });
  });

  it("steers an active turn when the composer has text", () => {
    expect(
      resolveChatComposerAction({
        composerText: "  refine this  ",
        hasActiveTurn: true,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "steer_turn",
      prompt: "refine this",
      shouldClearComposer: true,
    });
  });

  it("starts a turn when attachments are pending even without text", () => {
    expect(
      resolveChatComposerAction({
        composerText: "   ",
        hasActiveTurn: false,
        hasPendingAttachments: true,
      }),
    ).toEqual({
      type: "start_turn",
      prompt: "",
      shouldClearComposer: true,
    });
  });

  it("steers an active turn when attachments are pending even without text", () => {
    expect(
      resolveChatComposerAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingAttachments: true,
      }),
    ).toEqual({
      type: "steer_turn",
      prompt: "",
      shouldClearComposer: true,
    });
  });
});
