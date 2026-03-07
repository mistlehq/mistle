import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveChatComposerAction,
  resolveSessionHeaderStatusUi,
} from "./codex-session-page-view-model.js";

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
        agentConnectionState: "handshaking_agent",
        step: "connecting",
        hasConnectionError: false,
      }),
    ).toEqual({
      label: "Connecting",
      variant: "outline",
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
      }),
    ).toBe(false);
  });

  it("returns true when any alert source is present", () => {
    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        startErrorMessage: "Could not connect.",
        sandboxFailureMessage: null,
      }),
    ).toBe(true);
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
