import { describe, expect, it } from "vitest";

import { HttpApiError } from "../api/http-api-error.js";
import {
  resolveInitialEntryStartupState,
  resolveSandboxStatusRefetchInterval,
  shouldResetAutoResumeAttemptAfterClear,
  shouldClearAutoResumeInFlightState,
} from "./use-session-workbench-lifecycle-state.js";

describe("resolveInitialEntryStartupState", () => {
  it("does not show a startup state when chat is already ready on mount", () => {
    expect(
      resolveInitialEntryStartupState({
        mainPanelTransitionState: "stable_chat",
        sandboxLifecycleStatus: null,
        sandboxStatusReadState: "loading",
        sessionSnapshot: {
          activeRuntimeConversationId: "thread_test",
          activeRuntimeConversationCwd: "/root",
          connectedAtIso: "2026-04-21T00:00:00.000Z",
          providerConversationId: null,
          sandboxInstanceId: "sbi_test",
        },
      }),
    ).toBeNull();
  });

  it("still shows the loading startup state before chat exists", () => {
    expect(
      resolveInitialEntryStartupState({
        mainPanelTransitionState: "stable_chat",
        sandboxLifecycleStatus: null,
        sandboxStatusReadState: "loading",
        sessionSnapshot: null,
      }),
    ).toBe("loading_status");
  });

  it.each([
    ["pending", "preparing_sandbox"],
    ["starting", "running_setup"],
    ["started", "running_setup"],
    ["initializing", "running_setup"],
    ["resuming", "resuming_sandbox"],
    ["degraded", "reconnecting_sandbox"],
    ["reconnecting", "reconnecting_sandbox"],
    ["stopping", "stopping_sandbox"],
    ["running", "connecting_chat"],
    ["stopped", null],
    ["failed", null],
  ] as const)(
    "maps sandbox status %s to startup state %s before chat is ready",
    (status, state) => {
      expect(
        resolveInitialEntryStartupState({
          mainPanelTransitionState: "stable_chat",
          sandboxLifecycleStatus: status,
          sandboxStatusReadState: "ready",
          sessionSnapshot: null,
        }),
      ).toBe(state);
    },
  );
});

describe("resolveSandboxStatusRefetchInterval", () => {
  it("stops polling when the sandbox session is unavailable", () => {
    const error = new HttpApiError({
      operation: "getSandboxInstanceStatus",
      status: 404,
      body: { code: "INSTANCE_NOT_FOUND", message: "Sandbox instance was not found." },
      message: "Sandbox instance was not found.",
    });

    expect(
      resolveSandboxStatusRefetchInterval({
        triggerConversation: null,
        connectable: null,
        error,
        isAutoResumingStoppedSandbox: false,
        status: null,
      }),
    ).toBe(false);
  });

  it("keeps polling while a pending session has no unavailable-resource error", () => {
    expect(
      resolveSandboxStatusRefetchInterval({
        triggerConversation: null,
        connectable: null,
        error: null,
        isAutoResumingStoppedSandbox: false,
        status: "pending",
      }),
    ).toBe(1_000);
  });

  it("keeps polling while a queued auto-resume still reads as stopped", () => {
    expect(
      resolveSandboxStatusRefetchInterval({
        triggerConversation: null,
        connectable: null,
        error: null,
        isAutoResumingStoppedSandbox: true,
        status: "stopped",
      }),
    ).toBe(1_000);
  });
});

describe("shouldClearAutoResumeInFlightState", () => {
  it("keeps auto-resume pending while a resume request has not produced a connectable sandbox", () => {
    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: null,
        sessionConnectedAtIso: null,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);

    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: null,
        sessionConnectedAtIso: null,
        sandboxStatus: "starting",
      }),
    ).toBe(false);
  });

  it("keeps auto-resume pending while the sandbox is connectable but chat is not connected", () => {
    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: null,
        sessionConnectedAtIso: null,
        sandboxStatus: "running",
      }),
    ).toBe(false);
  });

  it("keeps auto-resume pending while only the stale pre-resume chat session is connected", () => {
    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sandboxStatus: "running",
      }),
    ).toBe(false);
  });

  it("clears auto-resume pending once a new chat session is connected", () => {
    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sessionConnectedAtIso: "2026-06-03T09:45:15.000Z",
        sandboxStatus: "running",
      }),
    ).toBe(true);
  });

  it("clears auto-resume pending when the sandbox fails", () => {
    expect(
      shouldClearAutoResumeInFlightState({
        resumeStartedSessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sessionConnectedAtIso: null,
        sandboxStatus: "failed",
      }),
    ).toBe(true);
  });
});

describe("shouldResetAutoResumeAttemptAfterClear", () => {
  it("keeps the one-shot guard when clearing because the sandbox failed", () => {
    expect(
      shouldResetAutoResumeAttemptAfterClear({
        resumeStartedSessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sessionConnectedAtIso: null,
      }),
    ).toBe(false);
  });

  it("resets the one-shot guard after a new connected session completes resume", () => {
    expect(
      shouldResetAutoResumeAttemptAfterClear({
        resumeStartedSessionConnectedAtIso: "2026-06-03T09:45:00.000Z",
        sessionConnectedAtIso: "2026-06-03T09:45:15.000Z",
      }),
    ).toBe(true);
  });
});
