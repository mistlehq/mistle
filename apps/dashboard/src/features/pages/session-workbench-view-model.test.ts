import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveChatComposerAction,
  resolveSessionHeaderStatusUi,
  resolveStoppedSessionMessage,
  shouldShowResumeAction,
} from "./session-workbench-view-model.js";

describe("resolveSessionHeaderStatusUi", () => {
  it("shows connected when the transport is ready", () => {
    expect(
      resolveSessionHeaderStatusUi({
        sandboxStatus: "running",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    });
  });

  it("prioritizes sandbox failures over connection state", () => {
    expect(
      resolveSessionHeaderStatusUi({
        sandboxStatus: "failed",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Sandbox failed",
      variant: "destructive",
    });
  });

  it("shows connecting while the agent is still handshaking", () => {
    expect(
      resolveSessionHeaderStatusUi({
        sandboxStatus: "running",
        agentConnectionState: "opening_agent_stream",
        step: "connecting",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Connecting",
      variant: "outline",
    });
  });

  it("shows resuming while a stopped sandbox resume is pending", () => {
    expect(
      resolveSessionHeaderStatusUi({
        sandboxStatus: "resuming",
        agentConnectionState: "idle",
        step: "securing",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Resuming sandbox",
      variant: "outline",
    });
  });

  it("shows connected once the agent channel is ready even if sandbox status is stale", () => {
    expect(
      resolveSessionHeaderStatusUi({
        sandboxStatus: "stopped",
        agentConnectionState: "ready",
        step: "connected",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    });
  });
});

describe("hasSessionTopAlert", () => {
  it("returns false when there are no visible alerts", () => {
    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        startErrorMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      }),
    ).toBe(false);
  });

  it("returns true when any alert source is present", () => {
    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        startErrorMessage: "Could not connect.",
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      }),
    ).toBe(true);

    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        startErrorMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: "This sandbox is stopped.",
      }),
    ).toBe(true);
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
      }),
    ).toEqual({
      type: "steer_turn",
      prompt: "refine this",
      shouldClearComposer: true,
    });
  });
});
