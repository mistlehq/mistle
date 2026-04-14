// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";
import {
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  reduceCodexRecoveryState,
  resolveSandboxStatusReadState,
  resolveCodexRecoveryStateForRender,
  resolveCodexReconnectMessage,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchController,
} from "./use-session-workbench-controller.js";

function createControllerQueryClient(input?: {
  gcTime?: number;
  refetchOnMount?: boolean;
  retry?: boolean;
  staleTime?: number;
}): QueryClient {
  return createTestQueryClient(input);
}

function createControllerWrapper(queryClient: QueryClient) {
  return function ControllerWrapper({ children }: React.PropsWithChildren): React.JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderSessionWorkbenchController(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string | null;
}) {
  return renderHook(
    ({ sandboxInstanceId }: { sandboxInstanceId: string | null }) =>
      useSessionWorkbenchController({
        sandboxInstanceId,
      }),
    {
      initialProps: {
        sandboxInstanceId: input.sandboxInstanceId,
      },
      wrapper: createControllerWrapper(input.queryClient),
    },
  );
}

describe("useSessionWorkbenchController", () => {
  it("returns separate workbench and conversation pane state for a missing session id", () => {
    const queryClient = createControllerQueryClient();
    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: null,
    });

    expect(Object.keys(result.current)).toEqual(["workbench", "conversationPane"]);
    expect(result.current.workbench.connectionReadiness).toEqual({
      canConnect: false,
      reason: "missing-session",
    });
    expect(result.current.workbench.stoppedSessionMessage).toBeNull();
    expect(result.current.workbench.workbenchStatus).toEqual({
      kind: "not_connected",
      alert: null,
    });
    expect(result.current.workbench.ptyState.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.workbench.ptyState.lifecycle.state).toBe("idle");
    expect(result.current.workbench.ptyState.output.chunks).toEqual([]);
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);
    expect(result.current.workbench.diffPanelState.isVisible).toBe(false);
    expect(result.current.workbench.diffPanelState.panelSize).toBe(42);
    expect(result.current.workbench.diffPanelState.patch).toBe("");
    expect(result.current.workbench.portAccessState.processes).toEqual([]);
    expect(result.current.workbench.portAccessState.isPanelOpen).toBe(false);
    expect(result.current.workbench.sandboxLifecycleStatus).toBeNull();
    expect(result.current.conversationPane.chatState.entries).toEqual([]);
    expect(result.current.conversationPane.composerStateInput.bootstrap.phase).toEqual({
      status: "unavailable",
    });
    expect(
      result.current.conversationPane.composerStateInput.bootstrap.establishedSnapshot
        .availableModels,
    ).toEqual([]);
    expect(result.current.conversationPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });

  it("starts Codex recovery from a recoverable disconnect and preserves attempts for the same event", () => {
    const startedRecovery = reduceCodexRecoveryState(
      { kind: "idle" },
      {
        type: "recoverable_disconnect_observed",
        disconnect: {
          id: 1,
          message: "Sandbox session stream reset.",
          targetThreadId: "thread_123",
          recoveryStrategy: "reopen_stream",
        },
      },
    );

    expect(startedRecovery).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream",
      reconnectAttemptCount: 0,
      reconnectCommand: "none",
      recoverableDisconnectId: 1,
    });

    const sameDisconnectReconnect = reduceCodexRecoveryState(startedRecovery, {
      type: "sync_observed",
      observation: {
        canConnect: true,
        connected: false,
        hasLifecycleError: false,
        isStartingSession: false,
        isWaitingForAutomationThread: false,
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
      },
    });
    const reconnectAttemptStarted = reduceCodexRecoveryState(sameDisconnectReconnect, {
      type: "reconnect_attempt_started",
    });

    expect(reconnectAttemptStarted).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream",
      reconnectAttemptCount: 1,
      reconnectCommand: "none",
      recoverableDisconnectId: 1,
    });

    expect(
      reduceCodexRecoveryState(reconnectAttemptStarted, {
        type: "recoverable_disconnect_observed",
        disconnect: {
          id: 1,
          message: "Sandbox session stream reset. Reconnect failed once; retrying.",
          targetThreadId: "thread_123",
          recoveryStrategy: "reopen_stream",
        },
      }),
    ).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset. Reconnect failed once; retrying.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream",
      reconnectAttemptCount: 1,
      reconnectCommand: "none",
      recoverableDisconnectId: 1,
    });
  });

  it("issues reconnect commands only when the recovered sandbox is connectable again", () => {
    const waitingRecovery = {
      kind: "recovering" as const,
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 0,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceCodexRecoveryState(waitingRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: false,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForAutomationThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "stopped",
        },
      }),
    ).toEqual(waitingRecovery);

    expect(
      reduceCodexRecoveryState(waitingRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: true,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForAutomationThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "running",
        },
      }),
    ).toEqual({
      ...waitingRecovery,
      reconnectCommand: "reopen_stream",
    });

    expect(
      reduceCodexRecoveryState(
        {
          ...waitingRecovery,
          recoveryStrategy: "reconnect_transport" as const,
        },
        {
          type: "sync_observed",
          observation: {
            canConnect: true,
            connected: false,
            hasLifecycleError: false,
            isStartingSession: false,
            isWaitingForAutomationThread: false,
            sandboxInstanceId: "sbi_123",
            sandboxStatus: "running",
          },
        },
      ),
    ).toEqual({
      ...waitingRecovery,
      recoveryStrategy: "reconnect_transport",
      reconnectCommand: "reconnect_transport",
    });
  });

  it("clears stale recovery state before render-time reconnect logic for a new sandbox", () => {
    expect(
      resolveCodexRecoveryStateForRender({
        baseState: {
          kind: "recovering",
          baseMessage: "Sandbox session stream reset.",
          errorMessage: null,
          targetThreadId: "thread_old",
          recoveryStrategy: "reopen_stream",
          reconnectAttemptCount: 0,
          reconnectCommand: "reopen_stream",
          recoverableDisconnectId: 1,
        },
        canConnect: true,
        hasLifecycleError: false,
        isStartingSession: false,
        isWaitingForAutomationThread: false,
        previousSandboxInstanceId: "sbi_old",
        sandboxInstanceId: "sbi_new",
        sandboxStatus: "running",
        sessionConnectionState: "detached",
      }),
    ).toEqual({
      kind: "idle",
    });
  });

  it("stops Codex recovery once attempts are exhausted or the sandbox fails", () => {
    const exhaustedRecovery = {
      kind: "recovering" as const,
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 3,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceCodexRecoveryState(exhaustedRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: true,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForAutomationThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "running",
        },
      }),
    ).toEqual({
      ...exhaustedRecovery,
      errorMessage: "Could not reconnect session after 3 attempts.",
    });

    const failedRecovery = {
      kind: "recovering" as const,
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetThreadId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 1,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceCodexRecoveryState(failedRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: false,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForAutomationThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "failed",
        },
      }),
    ).toEqual({
      ...failedRecovery,
      errorMessage:
        "Sandbox session stream reset. The sandbox failed and the session cannot reconnect.",
    });
  });

  it("formats reconnect messaging across running and stopped recovery phases", () => {
    expect(
      resolveCodexReconnectMessage({
        recoveryBaseMessage: "Sandbox session stream reset.",
        recoveryErrorMessage: null,
        reconnectAttemptCount: 1,
        sandboxStatus: "running",
      }),
    ).toBe("Sandbox session stream reset. Reconnecting session (attempt 1 of 3).");

    expect(
      resolveCodexReconnectMessage({
        recoveryBaseMessage: "Sandbox session stream reset.",
        recoveryErrorMessage: null,
        reconnectAttemptCount: 0,
        sandboxStatus: "stopped",
      }),
    ).toBe("Sandbox session stream reset. Resuming sandbox to restore the session.");
  });

  it("requires a post-reset sandbox status read before recovery can trust cached status", () => {
    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryDataUpdatedAtMs: 1_000,
        currentDataUpdatedAtMs: 1_000,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryDataUpdatedAtMs: 1_000,
        currentDataUpdatedAtMs: 1_001,
      }),
    ).toBe(true);

    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryDataUpdatedAtMs: null,
        currentDataUpdatedAtMs: 1_000,
      }),
    ).toBe(true);
  });

  it("keeps sandbox status ready after a transient refetch error when a fresh read already exists", () => {
    expect(
      resolveSandboxStatusReadState({
        hasFreshSandboxStatusSinceMount: true,
        hasFreshSandboxStatusSinceRecovery: true,
        hasStatusQueryError: true,
      }),
    ).toBe("ready");

    expect(
      resolveSandboxStatusReadState({
        hasFreshSandboxStatusSinceMount: false,
        hasFreshSandboxStatusSinceRecovery: true,
        hasStatusQueryError: true,
      }),
    ).toBe("error");
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

    const queryClient = createControllerQueryClient();
    const { result, rerender } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: sandboxInstanceIdOne,
    });

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

  it("treats status data as fresh only after a post-mount query update", () => {
    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: null,
        currentDataUpdatedAtMs: 0,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: 0,
        currentDataUpdatedAtMs: 0,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: 123,
        currentDataUpdatedAtMs: 124,
      }),
    ).toBe(true);
  });

  it.each([
    {
      expected: "loading",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: null,
      },
    },
    {
      expected: "resume_pending",
      input: {
        connectedSession: false,
        hasResumeInFlightState: true,
        sandboxStatus: "stopped" as const,
      },
    },
    {
      expected: "sandbox_stopped",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "stopped" as const,
      },
    },
    {
      expected: "sandbox_starting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "pending" as const,
      },
    },
    {
      expected: "sandbox_starting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "starting" as const,
      },
    },
    {
      expected: "connecting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "running" as const,
      },
    },
    {
      expected: "ready",
      input: {
        connectedSession: true,
        hasResumeInFlightState: false,
        sandboxStatus: "running" as const,
      },
    },
    {
      expected: "sandbox_failed",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "failed" as const,
      },
    },
  ])("routes session entry based on sandbox lifecycle status: $expected", ({ input, expected }) => {
    expect(resolveWorkbenchEntryPhase(input)).toBe(expected);
  });

  it("does not treat a seeded stopped cache as immediately trusted", () => {
    const sandboxInstanceId = `sbi-resume-${Date.now()}`;
    const queryClient = createControllerQueryClient({
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
      title: null,
      id: sandboxInstanceId,
      status: "stopped",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
      automationConversation: null,
    });

    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId,
    });

    expect(result.current.workbench.connectionReadiness.reason).toBe("unknown");
    expect(result.current.workbench.stoppedSessionMessage).toBeNull();
  });

  it("shows the stopped-session message once a stopped sandbox status is trusted", () => {
    expect(
      resolveStoppedSessionMessageForWorkbenchEntryPhase({
        autoResumeErrorMessage: "Could not resume sandbox session.",
        phase: "sandbox_stopped",
      }),
    ).toBe("Could not resume sandbox session.");

    expect(
      resolveStoppedSessionMessageForWorkbenchEntryPhase({
        autoResumeErrorMessage: null,
        phase: "sandbox_stopped",
      }),
    ).toBe("This sandbox is stopped. Chat and terminal are unavailable.");

    expect(
      resolveStoppedSessionMessageForWorkbenchEntryPhase({
        autoResumeErrorMessage: null,
        phase: "ready",
      }),
    ).toBeNull();
  });
});
