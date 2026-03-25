// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";
import {
  clearStoredResumeIdempotencyKey,
  createResumeIdempotencyStorageKey,
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  isActiveResumeRequest,
  persistResumeIdempotencyKey,
  readStoredResumeIdempotencyRecord,
  readStoredResumeIdempotencyKey,
  resolveSessionEntryPhase,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldClearStoredResumeIdempotencyKey,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldRetainResumeRetryWindowAfterError,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchController,
} from "./use-session-workbench-controller.js";

describe("useSessionWorkbenchController", () => {
  it("returns separate workbench and conversation pane state for a missing session id", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: React.PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSessionWorkbenchController({
          onResumeOnOpenHandled: () => {},
          resumeOnOpenRequestToken: null,
          sandboxInstanceId: null,
        }),
      {
        wrapper,
      },
    );

    expect(Object.keys(result.current)).toEqual(["workbench", "conversationPane"]);
    expect(result.current.workbench.connectionReadiness).toEqual({
      canConnect: false,
      reason: "missing-session",
    });
    expect(result.current.workbench.stoppedSessionState).toEqual({
      message: null,
      requiresManualResume: false,
    });
    expect(result.current.workbench.hasTopAlert).toBe(false);
    expect(result.current.workbench.ptyState.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.workbench.ptyState.lifecycle.state).toBe("closed");
    expect(result.current.workbench.ptyState.output.chunks).toEqual([]);
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);
    expect(result.current.workbench.startErrorMessage).toBeNull();
    expect(result.current.workbench.sandboxFailureMessage).toBeNull();
    expect(result.current.conversationPane.chatState.entries).toEqual([]);
    expect(result.current.conversationPane.composerProps.isConnected).toBe(false);
    expect(result.current.conversationPane.composerProps.modelOptions).toEqual([]);
    expect(result.current.conversationPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });

  it("persists terminal panel visibility and size per sandbox instance", () => {
    const hasStorageApi =
      typeof window.localStorage === "object" &&
      window.localStorage !== null &&
      typeof window.localStorage.getItem === "function" &&
      typeof window.localStorage.removeItem === "function";
    const sandboxInstanceIdOne = `sbi-one-${Date.now()}`;
    const sandboxInstanceIdTwo = `sbi-two-${Date.now()}`;

    if (hasStorageApi) {
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdOne}`,
      );
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdTwo}`,
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: React.PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      ({ sandboxInstanceId }: { sandboxInstanceId: string | null }) =>
        useSessionWorkbenchController({
          onResumeOnOpenHandled: () => {},
          resumeOnOpenRequestToken: null,
          sandboxInstanceId,
        }),
      {
        initialProps: {
          sandboxInstanceId: sandboxInstanceIdOne,
        },
        wrapper,
      },
    );

    act(() => {
      result.current.workbench.terminalPanelState.openPanel();
      result.current.workbench.terminalPanelState.setPanelSize(52);
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(true);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(52);

    rerender({
      sandboxInstanceId: sandboxInstanceIdTwo,
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);

    rerender({
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    const expectedVisibility = hasStorageApi;
    const expectedPanelSize = hasStorageApi ? 52 : DEFAULT_TERMINAL_PANEL_SIZE;

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(expectedVisibility);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(expectedPanelSize);
  });

  it("waits for automation-backed sessions whose persisted thread id is still pending", () => {
    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_pending",
          routeId: "cvr_pending",
          providerConversationId: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_ready",
          routeId: "cvr_ready",
          providerConversationId: "thread_ready",
        },
      }),
    ).toBe(false);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: null,
      }),
    ).toBe(false);
  });

  it("times out automation pending state after the configured wait window", () => {
    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(true);
  });

  it("computes the remaining automation preparation timeout delay", () => {
    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBeNull();

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 0,
      }),
    ).toBe(30_000);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(1);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(0);
  });

  it("namespaces resume idempotency storage keys per sandbox instance", () => {
    const sandboxInstanceId = `sbi-resume-${Date.now()}`;
    const otherSandboxInstanceId = `sbi-other-${Date.now()}`;

    expect(createResumeIdempotencyStorageKey(sandboxInstanceId)).not.toBe(
      createResumeIdempotencyStorageKey(otherSandboxInstanceId),
    );
  });

  it("treats missing browser storage as empty and no-ops writes", () => {
    const sandboxInstanceId = `sbi-resume-${Date.now()}`;

    expect(
      readStoredResumeIdempotencyKey({
        sandboxInstanceId,
        storage: null,
        nowMs: Date.now(),
      }),
    ).toBeNull();

    expect(() => {
      persistResumeIdempotencyKey({
        sandboxInstanceId,
        idempotencyKey: "resume-key-001",
        storage: null,
        nowMs: Date.now(),
      });

      clearStoredResumeIdempotencyKey({
        sandboxInstanceId,
        storage: null,
      });
    }).not.toThrow();
  });

  it("expires stored resume idempotency keys after the retry window", () => {
    let storedValue: string | null = null;
    const storage = {
      getItem(): string | null {
        return storedValue;
      },
      removeItem(): void {
        storedValue = null;
      },
      setItem(_key: string, value: string): void {
        storedValue = value;
      },
    };

    expect(
      persistResumeIdempotencyKey({
        sandboxInstanceId: "sbi_resume_001",
        idempotencyKey: "resume-key-001",
        storage,
        nowMs: 1_000,
      }),
    ).toBe(true);

    expect(
      readStoredResumeIdempotencyKey({
        sandboxInstanceId: "sbi_resume_001",
        storage,
        nowMs: 1_000 + 60_000,
      }),
    ).toBe("resume-key-001");

    expect(
      readStoredResumeIdempotencyRecord({
        sandboxInstanceId: "sbi_resume_001",
        storage,
        nowMs: 1_000 + 60_000,
      }),
    ).toEqual({
      value: "resume-key-001",
      expiresAtMs: 1_000 + 5 * 60 * 1_000,
    });

    expect(
      readStoredResumeIdempotencyKey({
        sandboxInstanceId: "sbi_resume_001",
        storage,
        nowMs: 1_000 + 5 * 60 * 1_000,
      }),
    ).toBeNull();
  });

  it("seeds the sandbox status query from a successful resume response", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    seedSandboxInstanceStatusQuery({
      queryClient,
      sandboxInstanceId: "sbi_resume_001",
      sandboxStatus: {
        id: "sbi_resume_001",
        status: "starting",
        failureCode: null,
        failureMessage: null,
        automationConversation: null,
      },
    });

    expect(queryClient.getQueryData(getSandboxInstanceStatusQueryKey("sbi_resume_001"))).toEqual({
      id: "sbi_resume_001",
      status: "starting",
      failureCode: null,
      failureMessage: null,
      automationConversation: null,
    });
  });

  it("preserves the stored resume key while the sandbox is still starting", () => {
    expect(shouldClearStoredResumeIdempotencyKey("stopped")).toBe(false);
    expect(shouldClearStoredResumeIdempotencyKey("starting")).toBe(false);
    expect(shouldClearStoredResumeIdempotencyKey(null)).toBe(false);

    expect(shouldClearStoredResumeIdempotencyKey("running")).toBe(true);
    expect(shouldClearStoredResumeIdempotencyKey("failed")).toBe(true);
  });

  it("routes session entry based on sandbox lifecycle status", () => {
    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: false,
        isStatusPending: true,
        sandboxStatus: null,
      }),
    ).toBe("loading");

    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: true,
        isStatusPending: false,
        sandboxStatus: "stopped",
      }),
    ).toBe("resume_pending");

    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: false,
        isStatusPending: false,
        sandboxStatus: "stopped",
      }),
    ).toBe("manual_resume_required");

    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: false,
        isStatusPending: false,
        sandboxStatus: "starting",
      }),
    ).toBe("sandbox_starting");

    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: false,
        isStatusPending: false,
        sandboxStatus: "running",
      }),
    ).toBe("connecting");

    expect(
      resolveSessionEntryPhase({
        connectedSession: true,
        hasResumePolicy: false,
        isStatusPending: false,
        sandboxStatus: "running",
      }),
    ).toBe("ready");

    expect(
      resolveSessionEntryPhase({
        connectedSession: false,
        hasResumePolicy: false,
        isStatusPending: false,
        sandboxStatus: "failed",
      }),
    ).toBe("sandbox_failed");
  });

  it("polls stopped sandbox status only while resume policy is active", () => {
    expect(
      shouldPollStoppedSandboxStatus({
        hasResumePolicy: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldPollStoppedSandboxStatus({
        hasResumePolicy: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);

    expect(
      shouldPollStoppedSandboxStatus({
        hasResumePolicy: true,
        sandboxStatus: "starting",
      }),
    ).toBe(false);
  });

  it("shows resume progress only while resume intent or request is active", () => {
    expect(
      shouldShowResumeInFlightState({
        hasResumeOnOpenIntent: true,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldShowResumeInFlightState({
        hasResumeOnOpenIntent: false,
        isResumingStoppedSandbox: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldShowResumeInFlightState({
        hasResumeOnOpenIntent: false,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);
  });

  it("retains the retry window only for ambiguous or server-side resume failures", () => {
    expect(shouldRetainResumeRetryWindowAfterError(new Error("network failure"))).toBe(true);
    expect(
      shouldRetainResumeRetryWindowAfterError(
        new SandboxProfilesApiError({
          operation: "resumeSandboxInstance",
          status: 500,
          body: null,
          message: "Server error",
        }),
      ),
    ).toBe(true);

    expect(
      shouldRetainResumeRetryWindowAfterError(
        new SandboxProfilesApiError({
          operation: "resumeSandboxInstance",
          status: 409,
          body: null,
          message: "Conflict",
        }),
      ),
    ).toBe(false);
  });

  it("shows definitive resume failures in the stopped-session message path", () => {
    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "manual_resume_required",
        resumeActionErrorMessage: "You no longer have access to this sandbox.",
      }),
    ).toBe("You no longer have access to this sandbox.");

    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "manual_resume_required",
        resumeActionErrorMessage: null,
      }),
    ).toBe("This sandbox is stopped. Resume it to reconnect chat and terminal.");

    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "resume_pending",
        resumeActionErrorMessage: "Conflict",
      }),
    ).toBeNull();
  });

  it("accepts resume completions only for the active request on the same sandbox", () => {
    expect(
      isActiveResumeRequest({
        activeRequest: null,
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 2,
          sandboxInstanceId: "sbi_resume_001",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 1,
          sandboxInstanceId: "sbi_resume_002",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 1,
          sandboxInstanceId: "sbi_resume_001",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(true);
  });

  it("keeps a reloaded stopped sandbox resumable even when a stored resume key exists", () => {
    const sandboxInstanceId = `sbi-resume-${Date.now()}`;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    persistResumeIdempotencyKey({
      sandboxInstanceId,
      idempotencyKey: "resume-key-001",
      storage: window.localStorage,
      nowMs: Date.now(),
    });
    seedSandboxInstanceStatusQuery({
      queryClient,
      sandboxInstanceId,
      sandboxStatus: {
        id: sandboxInstanceId,
        status: "stopped",
        failureCode: null,
        failureMessage: null,
        automationConversation: null,
      },
    });

    const wrapper = ({ children }: React.PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSessionWorkbenchController({
          onResumeOnOpenHandled: () => {},
          resumeOnOpenRequestToken: null,
          sandboxInstanceId,
        }),
      {
        wrapper,
      },
    );

    expect(result.current.workbench.isResumingStoppedSandbox).toBe(false);
    expect(result.current.workbench.connectionReadiness.reason).toBe("stopped");
    expect(result.current.workbench.stoppedSessionState.requiresManualResume).toBe(true);

    clearStoredResumeIdempotencyKey({
      sandboxInstanceId,
      storage: window.localStorage,
    });
  });
});
