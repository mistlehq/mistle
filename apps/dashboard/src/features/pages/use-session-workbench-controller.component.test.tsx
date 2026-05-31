// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient, flushScheduledReactWork } from "../../test-support/query-client.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import {
  hasTriggerSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveTriggerSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
  shouldWaitForTriggerSessionThread,
  useSessionWorkbenchController,
} from "./use-session-workbench-controller.js";
import {
  resolveSandboxStatusRefetchInterval,
  resolveSessionSnapshotStatusRefreshKey,
} from "./use-session-workbench-lifecycle-state.js";
import {
  reduceSessionWorkbenchRecoveryState,
  resolveSessionWorkbenchRecoveryStateForRender,
  resolveSessionReconnectMessage,
} from "./use-session-workbench-recovery.js";

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
    expect(typeof result.current.workbench.handleTerminalWorkspaceReset).toBe("function");
    expect(result.current.workbench.stoppedSessionMessage).toBeNull();
    expect(result.current.workbench.workbenchStatus).toEqual({
      kind: "not_connected",
      alert: null,
    });
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.diffPanelState.isVisible).toBe(false);
    expect(result.current.workbench.diffPanelState.patch).toBe("");
    expect(result.current.workbench.primaryPanelState.cliTerminalContentInset).toBe("default");
    expect(result.current.workbench.primaryPanelState.cliTerminalThemeMode).toBe("system");
    expect(result.current.workbench.primaryPanelState.cliRuntimeDisplayName).toBe("Codex");
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

  it("uses the OpenCode chat composer boundary for OpenCode runtime sessions", () => {
    const queryClient = createControllerQueryClient();
    const sandboxStatus: SandboxInstanceStatusResult = {
      id: "sbi_opencode",
      sandboxProfileId: "sbp_opencode",
      sandboxProfileVersion: 1,
      title: null,
      status: "starting",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: {
        agentRuntimeId: "opencode",
        launchCwd: "/workspace/repo",
        primaryRepositoryRoot: "/workspace/repo",
      },
      triggerConversation: null,
      startupOperation: null,
    };
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_opencode"), sandboxStatus);

    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: "sbi_opencode",
    });

    expect(result.current.conversationPane.composerStateInput.modelSelection).toEqual({
      required: false,
      showControls: true,
    });
    expect(result.current.conversationPane.composerStateInput.bootstrap.phase).toEqual({
      status: "unavailable",
    });
    expect(result.current.conversationPane.composerStateInput.contextUsage).toBeNull();
    expect(result.current.conversationPane.serverRequestsState.pendingServerRequests).toEqual([]);
    expect(result.current.workbench.primaryPanelState.canEnterCli).toBe(false);
    expect(result.current.workbench.primaryPanelState.disabledReason).toBe(
      "TUI is available after the session is connected.",
    );
    expect(result.current.workbench.primaryPanelState.cliTerminalContentInset).toBe("none");
    expect(result.current.workbench.primaryPanelState.cliTerminalThemeMode).toBe("system");
    expect(result.current.workbench.primaryPanelState.cliRuntimeDisplayName).toBe("OpenCode");
  });

  it("starts session recovery from a recoverable disconnect and preserves attempts for the same event", () => {
    const startedRecovery = reduceSessionWorkbenchRecoveryState(
      { kind: "idle" },
      {
        type: "recoverable_disconnect_observed",
        disconnect: {
          id: 1,
          message: "Sandbox session stream reset.",
          targetRuntimeConversationId: "thread_123",
          recoveryStrategy: "reopen_stream",
        },
      },
    );

    expect(startedRecovery).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetRuntimeConversationId: "thread_123",
      recoveryStrategy: "reopen_stream",
      reconnectAttemptCount: 0,
      reconnectCommand: "none",
      recoverableDisconnectId: 1,
    });

    const sameDisconnectReconnect = reduceSessionWorkbenchRecoveryState(startedRecovery, {
      type: "sync_observed",
      observation: {
        canConnect: true,
        connected: false,
        hasLifecycleError: false,
        isStartingSession: false,
        isWaitingForTriggerThread: false,
        sandboxInstanceId: "sbi_123",
        sandboxStatus: "running",
      },
    });
    const reconnectAttemptStarted = reduceSessionWorkbenchRecoveryState(sameDisconnectReconnect, {
      type: "reconnect_attempt_started",
    });

    expect(reconnectAttemptStarted).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetRuntimeConversationId: "thread_123",
      recoveryStrategy: "reopen_stream",
      reconnectAttemptCount: 1,
      reconnectCommand: "none",
      recoverableDisconnectId: 1,
    });

    expect(
      reduceSessionWorkbenchRecoveryState(reconnectAttemptStarted, {
        type: "recoverable_disconnect_observed",
        disconnect: {
          id: 1,
          message: "Sandbox session stream reset. Reconnect failed once; retrying.",
          targetRuntimeConversationId: "thread_123",
          recoveryStrategy: "reopen_stream",
        },
      }),
    ).toEqual({
      kind: "recovering",
      baseMessage: "Sandbox session stream reset. Reconnect failed once; retrying.",
      errorMessage: null,
      targetRuntimeConversationId: "thread_123",
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
      targetRuntimeConversationId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 0,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceSessionWorkbenchRecoveryState(waitingRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: false,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForTriggerThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "stopped",
        },
      }),
    ).toEqual(waitingRecovery);

    expect(
      reduceSessionWorkbenchRecoveryState(waitingRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: true,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForTriggerThread: false,
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "running",
        },
      }),
    ).toEqual({
      ...waitingRecovery,
      reconnectCommand: "reopen_stream",
    });

    expect(
      reduceSessionWorkbenchRecoveryState(
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
            isWaitingForTriggerThread: false,
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
      resolveSessionWorkbenchRecoveryStateForRender({
        baseState: {
          kind: "recovering",
          baseMessage: "Sandbox session stream reset.",
          errorMessage: null,
          targetRuntimeConversationId: "thread_old",
          recoveryStrategy: "reopen_stream",
          reconnectAttemptCount: 0,
          reconnectCommand: "reopen_stream",
          recoverableDisconnectId: 1,
        },
        canConnect: true,
        hasLifecycleError: false,
        isStartingSession: false,
        isWaitingForTriggerThread: false,
        previousSandboxInstanceId: "sbi_old",
        sandboxInstanceId: "sbi_new",
        sandboxStatus: "running",
        sessionConnectionState: "detached",
      }),
    ).toEqual({
      kind: "idle",
    });
  });

  it("stops session recovery once attempts are exhausted or the sandbox fails", () => {
    const exhaustedRecovery = {
      kind: "recovering" as const,
      baseMessage: "Sandbox session stream reset.",
      errorMessage: null,
      targetRuntimeConversationId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 3,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceSessionWorkbenchRecoveryState(exhaustedRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: true,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForTriggerThread: false,
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
      targetRuntimeConversationId: "thread_123",
      recoveryStrategy: "reopen_stream" as const,
      reconnectAttemptCount: 1,
      reconnectCommand: "none" as const,
      recoverableDisconnectId: 1,
    };

    expect(
      reduceSessionWorkbenchRecoveryState(failedRecovery, {
        type: "sync_observed",
        observation: {
          canConnect: false,
          connected: false,
          hasLifecycleError: false,
          isStartingSession: false,
          isWaitingForTriggerThread: false,
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
      resolveSessionReconnectMessage({
        recoveryBaseMessage: "Sandbox session stream reset.",
        recoveryErrorMessage: null,
        reconnectAttemptCount: 1,
        sandboxStatus: "running",
      }),
    ).toBe("Sandbox session stream reset. Reconnecting session (attempt 1 of 3).");

    expect(
      resolveSessionReconnectMessage({
        recoveryBaseMessage: "Sandbox session stream reset.",
        recoveryErrorMessage: null,
        reconnectAttemptCount: 0,
        sandboxStatus: "degraded",
      }),
    ).toBe("Sandbox session stream reset. Waiting for the sandbox to become ready again.");

    expect(
      resolveSessionReconnectMessage({
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
        recoveryBoundaryEpoch: 1,
        latestCompletedRecoveryRefreshEpoch: 0,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryEpoch: 1,
        latestCompletedRecoveryRefreshEpoch: 1,
      }),
    ).toBe(true);

    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryEpoch: null,
        latestCompletedRecoveryRefreshEpoch: 0,
      }),
    ).toBe(true);
  });

  it("does not trust a refresh that completed before the latest reset boundary", () => {
    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryEpoch: 2,
        latestCompletedRecoveryRefreshEpoch: 1,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusReadSinceRecoveryBoundary({
        recoveryBoundaryEpoch: 2,
        latestCompletedRecoveryRefreshEpoch: 2,
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

  it("persists terminal panel visibility per sandbox instance", () => {
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
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(true);

    rerender({
      sandboxInstanceId: sandboxInstanceIdTwo,
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);

    rerender({
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    const expectedVisibility = hasStorageApi;

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(expectedVisibility);
  });

  it("persists diff panel visibility per sandbox instance", () => {
    const hasStorageApi =
      typeof window.localStorage === "object" &&
      window.localStorage !== null &&
      typeof window.localStorage.getItem === "function" &&
      typeof window.localStorage.removeItem === "function";
    const sandboxInstanceIdOne = `sbi-diff-one-${Date.now()}`;
    const sandboxInstanceIdTwo = `sbi-diff-two-${Date.now()}`;

    if (hasStorageApi) {
      window.localStorage.removeItem(`dashboard:session-diff-workbench:${sandboxInstanceIdOne}`);
      window.localStorage.removeItem(`dashboard:session-diff-workbench:${sandboxInstanceIdTwo}`);
    }

    const queryClient = createControllerQueryClient();
    const { result, rerender } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    act(() => {
      result.current.workbench.diffPanelState.openPanel();
    });

    expect(result.current.workbench.diffPanelState.isVisible).toBe(true);

    rerender({
      sandboxInstanceId: sandboxInstanceIdTwo,
    });

    expect(result.current.workbench.diffPanelState.isVisible).toBe(false);

    rerender({
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    const expectedVisibility = hasStorageApi;

    expect(result.current.workbench.diffPanelState.isVisible).toBe(expectedVisibility);
  });

  it("waits for trigger-backed sessions whose persisted thread id is still pending", () => {
    expect(
      shouldWaitForTriggerSessionThread({
        sandboxStatus: "running",
        triggerConversation: {
          conversationId: "cnv_pending",
          routeId: "cvr_pending",
          providerConversationId: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldWaitForTriggerSessionThread({
        sandboxStatus: "running",
        triggerConversation: {
          conversationId: "cnv_ready",
          routeId: "cvr_ready",
          providerConversationId: "thread_ready",
        },
      }),
    ).toBe(false);

    expect(
      shouldWaitForTriggerSessionThread({
        sandboxStatus: "running",
        triggerConversation: null,
      }),
    ).toBe(false);
  });

  it("times out trigger pending state after the configured wait window", () => {
    expect(
      hasTriggerSessionPreparationTimedOut({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBe(false);

    expect(
      hasTriggerSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(false);

    expect(
      hasTriggerSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(true);
  });

  it("computes the remaining trigger preparation timeout delay", () => {
    expect(
      resolveTriggerSessionPreparationTimeoutDelayMs({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBeNull();

    expect(
      resolveTriggerSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 0,
      }),
    ).toBe(30_000);

    expect(
      resolveTriggerSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(1);

    expect(
      resolveTriggerSessionPreparationTimeoutDelayMs({
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
      expected: "sandbox_pending",
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
      expected: "sandbox_started",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "started" as const,
      },
    },
    {
      expected: "sandbox_initializing",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "initializing" as const,
      },
    },
    {
      expected: "sandbox_reconnecting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "reconnecting" as const,
      },
    },
    {
      expected: "sandbox_stopping",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        sandboxStatus: "stopping" as const,
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
      runtimeContext: null,
      triggerConversation: null,
      startupOperation: null,
    });

    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId,
    });

    expect(result.current.workbench.connectionReadiness.reason).toBe("unknown");
    expect(result.current.workbench.stoppedSessionMessage).toBeNull();
  });

  it("waits for a fresh route-entry status read before trusting a seeded connectable cache", async () => {
    const sandboxInstanceId = `sbi-connectable-${Date.now()}`;
    const sandboxStatus: SandboxInstanceStatusResult = {
      title: null,
      id: sandboxInstanceId,
      sandboxProfileId: "sbp_connectable",
      sandboxProfileVersion: 1,
      status: "running",
      connectable: true,
      failureCode: null,
      failureMessage: null,
      runtimeContext: {
        agentRuntimeId: "codex",
        launchCwd: "/workspace/repo",
        primaryRepositoryRoot: "/workspace/repo",
      },
      triggerConversation: null,
      startupOperation: null,
    };
    const queryClient = createControllerQueryClient({
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), sandboxStatus, {
      updatedAt: 1,
    });

    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId,
    });

    expect(result.current.workbench.connectionReadiness.reason).toBe("unknown");

    await act(async () => {
      await flushScheduledReactWork();
    });

    await act(async () => {
      queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), sandboxStatus, {
        updatedAt: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.workbench.connectionReadiness).toEqual({
        canConnect: true,
        reason: "ready",
      });
    });
  });

  it("stops polling once a session is connectable", () => {
    expect(
      resolveSandboxStatusRefetchInterval({
        triggerConversation: null,
        connectable: true,
        error: null,
        isAutoResumingStoppedSandbox: false,
        status: "running",
      }),
    ).toBe(false);
  });

  it("keys an immediate status refresh to one connected session snapshot", () => {
    const sessionSnapshot = {
      sandboxInstanceId: "sbi_reconnect_refresh",
      connectedAtIso: "2026-05-31T23:37:17.208Z",
    };

    expect(
      resolveSessionSnapshotStatusRefreshKey({
        connectionReadinessReason: "starting",
        sandboxInstanceId: "sbi_reconnect_refresh",
        sessionSnapshot,
      }),
    ).toBe("sbi_reconnect_refresh:2026-05-31T23:37:17.208Z");

    expect(
      resolveSessionSnapshotStatusRefreshKey({
        connectionReadinessReason: "ready",
        sandboxInstanceId: "sbi_reconnect_refresh",
        sessionSnapshot,
      }),
    ).toBeNull();

    expect(
      resolveSessionSnapshotStatusRefreshKey({
        connectionReadinessReason: "starting",
        sandboxInstanceId: "sbi_other",
        sessionSnapshot,
      }),
    ).toBeNull();
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
