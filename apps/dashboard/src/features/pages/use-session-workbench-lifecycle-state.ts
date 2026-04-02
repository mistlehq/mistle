import { systemScheduler } from "@mistle/time";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  type ResumeRequestGuard,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  isActiveResumeRequest,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveSandboxLifecycleStatusForWorkbenchEntryPhase,
  resolveSandboxStatusReadState,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveTrustedSandboxStatus,
  resolveWorkbenchEntryPhase,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
} from "./session-workbench-state.js";

const AutomationSessionStatusRefetchIntervalMs = 2_000;
const AutomationSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";
const MaxCodexReconnectAttempts = 3;
const CodexReconnectLimitMessage = `Could not reconnect session after ${String(MaxCodexReconnectAttempts)} attempts.`;

type RecoverableCodexDisconnect = {
  id: number;
  message: string;
  targetThreadId: string | null;
  recoveryStrategy: "reconnect_transport" | "reopen_stream";
};

type CodexRecoveryReconnectCommand = "none" | "reconnect_transport" | "reopen_stream";

type CodexRecoveryObservedState = {
  canConnect: boolean;
  connected: boolean;
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForAutomationThread: boolean;
  sandboxInstanceId: string | null;
  sandboxStatus: "pending" | "resuming" | "starting" | "running" | "stopped" | "failed" | null;
};

export type CodexRecoveryState =
  | {
      kind: "idle";
    }
  | {
      kind: "recovering";
      baseMessage: string;
      errorMessage: string | null;
      targetThreadId: string | null;
      recoveryStrategy: "reconnect_transport" | "reopen_stream";
      reconnectAttemptCount: number;
      reconnectCommand: CodexRecoveryReconnectCommand;
      recoverableDisconnectId: number;
    };

export type CodexRecoveryEvent =
  | {
      type: "recoverable_disconnect_observed";
      disconnect: RecoverableCodexDisconnect;
    }
  | {
      type: "reconnect_attempt_started";
    }
  | {
      type: "sandbox_changed";
    }
  | {
      type: "session_connected";
    }
  | {
      type: "sync_observed";
      observation: CodexRecoveryObservedState;
    };

function createCodexRecoveryStateFromDisconnect(
  disconnect: RecoverableCodexDisconnect,
): CodexRecoveryState {
  return {
    kind: "recovering",
    baseMessage: disconnect.message,
    errorMessage: null,
    targetThreadId: disconnect.targetThreadId,
    recoveryStrategy: disconnect.recoveryStrategy,
    reconnectAttemptCount: 0,
    reconnectCommand: "none",
    recoverableDisconnectId: disconnect.id,
  };
}

export function reduceCodexRecoveryState(
  state: CodexRecoveryState,
  event: CodexRecoveryEvent,
): CodexRecoveryState {
  switch (state.kind) {
    case "idle": {
      if (event.type === "recoverable_disconnect_observed") {
        return createCodexRecoveryStateFromDisconnect(event.disconnect);
      }

      return state;
    }

    case "recovering": {
      switch (event.type) {
        case "recoverable_disconnect_observed": {
          if (state.recoverableDisconnectId === event.disconnect.id) {
            return {
              ...state,
              baseMessage: event.disconnect.message,
              targetThreadId: event.disconnect.targetThreadId,
              recoveryStrategy: event.disconnect.recoveryStrategy,
            };
          }

          return createCodexRecoveryStateFromDisconnect(event.disconnect);
        }

        case "reconnect_attempt_started": {
          if (state.reconnectCommand === "none") {
            return state;
          }

          return {
            ...state,
            reconnectAttemptCount: state.reconnectAttemptCount + 1,
            reconnectCommand: "none",
          };
        }

        case "sandbox_changed":
        case "session_connected": {
          return {
            kind: "idle",
          };
        }

        case "sync_observed": {
          if (event.observation.connected) {
            return {
              kind: "idle",
            };
          }

          if (state.errorMessage !== null) {
            return state.reconnectCommand === "none"
              ? state
              : {
                  ...state,
                  reconnectCommand: "none",
                };
          }

          if (event.observation.sandboxStatus === "failed") {
            return {
              ...state,
              errorMessage: `${state.baseMessage} The sandbox failed and the session cannot reconnect.`,
              reconnectCommand: "none",
            };
          }

          if (state.reconnectAttemptCount >= MaxCodexReconnectAttempts) {
            return {
              ...state,
              errorMessage: CodexReconnectLimitMessage,
              reconnectCommand: "none",
            };
          }

          if (
            event.observation.sandboxInstanceId === null ||
            !event.observation.canConnect ||
            event.observation.hasLifecycleError ||
            event.observation.isStartingSession ||
            event.observation.isWaitingForAutomationThread ||
            event.observation.sandboxStatus !== "running"
          ) {
            return state.reconnectCommand === "none"
              ? state
              : {
                  ...state,
                  reconnectCommand: "none",
                };
          }

          const reconnectCommand =
            state.recoveryStrategy === "reopen_stream" ? "reopen_stream" : "reconnect_transport";

          return state.reconnectCommand === reconnectCommand
            ? state
            : {
                ...state,
                reconnectCommand,
              };
        }
      }
    }
  }
}

export function resolveCodexReconnectMessage(input: {
  recoveryBaseMessage: string | null;
  recoveryErrorMessage: string | null;
  reconnectAttemptCount: number;
  sandboxStatus: "pending" | "resuming" | "starting" | "running" | "stopped" | "failed" | null;
}): string | null {
  if (input.recoveryErrorMessage !== null) {
    return input.recoveryErrorMessage;
  }

  if (input.recoveryBaseMessage === null) {
    return null;
  }

  if (input.sandboxStatus === "stopped") {
    return `${input.recoveryBaseMessage} Resuming sandbox to restore the session.`;
  }

  if (
    input.sandboxStatus === "pending" ||
    input.sandboxStatus === "resuming" ||
    input.sandboxStatus === "starting" ||
    input.sandboxStatus === null
  ) {
    return `${input.recoveryBaseMessage} Waiting for the sandbox to become ready again.`;
  }

  if (input.sandboxStatus === "failed") {
    return `${input.recoveryBaseMessage} The sandbox failed and the session cannot reconnect.`;
  }

  return `${input.recoveryBaseMessage} Reconnecting session${input.reconnectAttemptCount > 0 ? ` (attempt ${String(input.reconnectAttemptCount)} of ${String(MaxCodexReconnectAttempts)})` : ""}.`;
}

function resolveResumeFailureMessage(error: unknown): string {
  if (error instanceof SandboxProfilesApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Could not resume sandbox session.";
}

export function getSandboxInstanceStatusQueryKey(
  sandboxInstanceId: string | null,
): readonly ["sandbox-instance-status", string | null] {
  return ["sandbox-instance-status", sandboxInstanceId];
}

export function seedSandboxInstanceStatusQuery(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string;
  sandboxStatus: Awaited<ReturnType<typeof getSandboxInstanceStatus>>;
}): void {
  input.queryClient.setQueryData(
    getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    input.sandboxStatus,
  );
}

export function useSessionWorkbenchLifecycleState(input: {
  sandboxInstanceId: string | null;
  mainPanelTransitionState: MainPanelTransitionState;
  lifecycle: Pick<
    ReturnType<typeof useCodexSessionState>["lifecycle"],
    | "clearLifecycleErrorMessage"
    | "connectSession"
    | "detachSessionTransport"
    | "disconnectSession"
    | "isStartingSession"
    | "lifecycleErrorMessage"
    | "recoverSession"
    | "recoverableDisconnect"
    | "sessionSnapshot"
    | "transportState"
  >;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  queryClient: QueryClient;
}) {
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const [hasAttemptedInitialStoppedResume, setHasAttemptedInitialStoppedResume] = useState(false);
  const [isResumingStoppedSandbox, setIsResumingStoppedSandbox] = useState(false);
  const [resumeActionErrorMessage, setResumeActionErrorMessage] = useState<string | null>(null);
  const [codexRecoveryState, dispatchCodexRecoveryEvent] = useReducer(reduceCodexRecoveryState, {
    kind: "idle",
  });
  const activeResumeRequestRef = useRef<ResumeRequestGuard | null>(null);
  const resumeIdempotencyKeyRef = useRef<string | null>(null);
  const nextResumeRequestIdRef = useRef(0);
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);
  // Recovery must not trust a cached pre-reset "running" read. Each reset/disconnect
  // records the latest query timestamp and blocks reconnect logic until a newer read lands.
  const recoveryStatusBoundaryDataUpdatedAtRef = useRef<number | null>(null);
  const lastRecoverableDisconnectIdRef = useRef<number | null>(null);

  const {
    clearLifecycleErrorMessage,
    connectSession,
    sessionSnapshot,
    disconnectSession,
    isStartingSession,
    lifecycleErrorMessage,
    recoverSession,
    recoverableDisconnect,
    transportState,
  } = input.lifecycle;
  const { disconnectPty } = input.ptyState.actions;

  const sandboxStatusQuery = useQuery({
    queryKey: getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    queryFn: async ({ signal }) => {
      if (input.sandboxInstanceId === null) {
        throw new Error("Session id is required.");
      }

      return getSandboxInstanceStatus({
        instanceId: input.sandboxInstanceId,
        signal,
      });
    },
    enabled: input.sandboxInstanceId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const automationConversation = query.state.data?.automationConversation ?? null;
      if (
        shouldWaitForAutomationSessionThread({
          sandboxStatus: status ?? null,
          automationConversation,
        })
      ) {
        return AutomationSessionStatusRefetchIntervalMs;
      }

      if (
        shouldPollStoppedSandboxStatus({
          sandboxStatus: status ?? null,
          hasAttemptedInitialStoppedResume,
          isResumingStoppedSandbox,
          resumeActionErrorMessage,
        })
      ) {
        return 1_000;
      }

      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });

  if (initialSandboxStatusDataUpdatedAtRef.current === null) {
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }

  const hasFreshSandboxStatusSinceMount = hasFreshSandboxStatusRead({
    initialDataUpdatedAtMs: initialSandboxStatusDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const hasFreshSandboxStatusSinceRecovery = hasFreshSandboxStatusReadSinceRecoveryBoundary({
    recoveryBoundaryDataUpdatedAtMs: recoveryStatusBoundaryDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const sandboxStatusReadState = resolveSandboxStatusReadState({
    hasFreshSandboxStatusSinceMount,
    hasFreshSandboxStatusSinceRecovery,
    hasStatusQueryError: sandboxStatusQuery.isError,
  });
  const trustedSandboxStatus = resolveTrustedSandboxStatus({
    sandboxStatusReadState,
    sandboxStatus: sandboxStatusQuery.data?.status ?? null,
  });
  const shouldAttemptRecoverableStoppedResume =
    input.sandboxInstanceId !== null &&
    trustedSandboxStatus === "stopped" &&
    recoverableDisconnect !== null;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    trustedSandboxStatus === "stopped" &&
    recoverableDisconnect === null &&
    !hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
    hasAttemptedInitialStoppedResume,
    resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
    isResumingStoppedSandbox,
    sandboxStatus: trustedSandboxStatus,
  });
  const workbenchEntryPhase = resolveWorkbenchEntryPhase({
    connectedSession: sessionSnapshot !== null,
    hasResumeInFlightState: isShowingResumeInFlightState,
    sandboxStatus: trustedSandboxStatus,
  });
  const displaySandboxLifecycleStatus =
    resolveSandboxLifecycleStatusForWorkbenchEntryPhase(workbenchEntryPhase);
  const automationConversation = sandboxStatusQuery.data?.automationConversation ?? null;
  const isWaitingForAutomationThread = shouldWaitForAutomationSessionThread({
    sandboxStatus: displaySandboxLifecycleStatus,
    automationConversation,
  });
  const connectionReadiness = resolveSessionConnectionReadiness({
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: displaySandboxLifecycleStatus,
    isStatusPending: sandboxStatusQuery.isPending,
  });
  const stoppedSessionMessage = resolveStoppedSessionMessageForWorkbenchEntryPhase({
    phase: workbenchEntryPhase,
    resumeActionErrorMessage,
  });
  const stoppedSessionState = {
    message: stoppedSessionMessage,
    requiresManualResume: stoppedSessionMessage !== null,
  };

  useEffect(() => {
    if (recoverableDisconnect === null) {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "recoverable_disconnect_observed",
      disconnect: recoverableDisconnect,
    });
  }, [recoverableDisconnect]);

  useEffect(() => {
    if (recoverableDisconnect === null) {
      return;
    }

    if (lastRecoverableDisconnectIdRef.current === recoverableDisconnect.id) {
      return;
    }

    lastRecoverableDisconnectIdRef.current = recoverableDisconnect.id;
    recoveryStatusBoundaryDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
    void sandboxStatusQuery.refetch().catch(() => {});
  }, [recoverableDisconnect, sandboxStatusQuery.dataUpdatedAt, sandboxStatusQuery.refetch]);

  useEffect(() => {
    if (input.ptyState.lifecycle.resetInfo === null) {
      return;
    }

    recoveryStatusBoundaryDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
    void sandboxStatusQuery.refetch().catch(() => {});
  }, [
    input.ptyState.lifecycle.resetInfo,
    sandboxStatusQuery.dataUpdatedAt,
    sandboxStatusQuery.refetch,
  ]);

  useEffect(() => {
    if (transportState !== "connected") {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "session_connected",
    });
  }, [transportState]);

  useEffect(() => {
    return () => {
      clearLifecycleErrorMessage();
      disconnectSession();
      void disconnectPty();
    };
  }, [clearLifecycleErrorMessage, disconnectPty, disconnectSession]);

  useEffect(() => {
    setHasAttemptedAutoConnect(false);
    setAutomationPendingSinceMs(null);
    setAutomationPendingErrorMessage(null);
    setHasAttemptedInitialStoppedResume(false);
    setIsResumingStoppedSandbox(false);
    setResumeActionErrorMessage(null);
    dispatchCodexRecoveryEvent({
      type: "sandbox_changed",
    });
    activeResumeRequestRef.current = null;
    resumeIdempotencyKeyRef.current = null;
    initialSandboxStatusDataUpdatedAtRef.current = null;
    recoveryStatusBoundaryDataUpdatedAtRef.current = null;
    lastRecoverableDisconnectIdRef.current = null;
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.mainPanelTransitionState === "stable_chat") {
      setHasAttemptedAutoConnect(false);
    }
  }, [input.mainPanelTransitionState]);

  useEffect(() => {
    if (!isWaitingForAutomationThread) {
      setAutomationPendingSinceMs(null);
      setAutomationPendingErrorMessage(null);
      return;
    }

    if (automationPendingSinceMs === null) {
      setAutomationPendingSinceMs(Date.now());
      return;
    }

    if (
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: automationPendingSinceMs,
        nowMs: Date.now(),
      })
    ) {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
      return;
    }

    const timeoutDelayMs = resolveAutomationSessionPreparationTimeoutDelayMs({
      pendingSinceMs: automationPendingSinceMs,
      nowMs: Date.now(),
    });

    if (timeoutDelayMs === null) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
    }, timeoutDelayMs);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [automationPendingSinceMs, isWaitingForAutomationThread]);

  const resolvedLifecycleErrorMessage = lifecycleErrorMessage ?? automationPendingErrorMessage;
  const codexRecoveryBaseMessage =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.baseMessage : null;
  const codexRecoveryErrorMessage =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.errorMessage : null;
  const codexReconnectAttemptCount =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.reconnectAttemptCount : 0;
  const sessionReconnectMessage = resolveCodexReconnectMessage({
    recoveryBaseMessage: codexRecoveryBaseMessage,
    recoveryErrorMessage: codexRecoveryErrorMessage,
    reconnectAttemptCount: codexReconnectAttemptCount,
    sandboxStatus: displaySandboxLifecycleStatus,
  });

  useEffect(() => {
    dispatchCodexRecoveryEvent({
      type: "sync_observed",
      observation: {
        canConnect: connectionReadiness.canConnect,
        connected: transportState === "connected",
        hasLifecycleError: resolvedLifecycleErrorMessage !== null,
        isStartingSession,
        isWaitingForAutomationThread,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: displaySandboxLifecycleStatus,
      },
    });
  }, [
    connectionReadiness.canConnect,
    displaySandboxLifecycleStatus,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedLifecycleErrorMessage,
    transportState,
  ]);

  useEffect(() => {
    if (input.mainPanelTransitionState !== "stable_chat") {
      return;
    }

    if (input.sandboxInstanceId === null) {
      return;
    }

    if (
      !shouldAutoConnectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        canConnect: connectionReadiness.canConnect,
        connected: transportState === "connected",
        isStartingSession,
        hasAttemptedAutoConnect,
        hasStartError: resolvedLifecycleErrorMessage !== null,
      })
    ) {
      return;
    }

    if (isWaitingForAutomationThread) {
      return;
    }

    setHasAttemptedAutoConnect(true);
    connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: automationConversation?.providerConversationId ?? null,
      providerThreadId: automationConversation?.providerConversationId ?? null,
    });
  }, [
    automationConversation,
    connectSession,
    input.mainPanelTransitionState,
    connectionReadiness.canConnect,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedLifecycleErrorMessage,
    transportState,
  ]);

  useEffect(() => {
    if (input.mainPanelTransitionState !== "stable_chat") {
      return;
    }

    if (codexRecoveryState.kind !== "recovering") {
      return;
    }

    if (codexRecoveryState.reconnectCommand === "none") {
      return;
    }

    if (input.sandboxInstanceId === null) {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "reconnect_attempt_started",
    });
    const recoveryInput = {
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: codexRecoveryState.targetThreadId,
    };

    if (codexRecoveryState.reconnectCommand === "reopen_stream") {
      recoverSession(recoveryInput);
      return;
    }

    connectSession(recoveryInput);
  }, [
    codexRecoveryState,
    connectSession,
    input.mainPanelTransitionState,
    input.sandboxInstanceId,
    recoverSession,
  ]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || sessionSnapshot === null) {
      return;
    }

    if (connectionReadiness.reason !== "starting") {
      return;
    }

    void sandboxStatusQuery.refetch();
  }, [
    connectionReadiness.reason,
    input.sandboxInstanceId,
    sessionSnapshot,
    sandboxStatusQuery.refetch,
  ]);

  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;

  const requestStoppedSandboxResume = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      trustedSandboxStatus !== "stopped" ||
      isResumingStoppedSandbox
    ) {
      return;
    }

    const idempotencyKey = resumeIdempotencyKeyRef.current ?? crypto.randomUUID();
    resumeIdempotencyKeyRef.current = idempotencyKey;
    const requestId = nextResumeRequestIdRef.current + 1;
    nextResumeRequestIdRef.current = requestId;
    activeResumeRequestRef.current = {
      requestId,
      sandboxInstanceId: input.sandboxInstanceId,
    };
    setHasAttemptedInitialStoppedResume(true);
    setResumeActionErrorMessage(null);

    clearLifecycleErrorMessage();
    setIsResumingStoppedSandbox(true);
    try {
      const resumedSandboxStatus = await resumeSandboxInstance({
        instanceId: input.sandboxInstanceId,
        idempotencyKey,
      });
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }
      seedSandboxInstanceStatusQuery({
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: resumedSandboxStatus,
      });
      if (resumedSandboxStatus.status !== "stopped") {
        resumeIdempotencyKeyRef.current = null;
      }
      clearLifecycleErrorMessage();
      setHasAttemptedAutoConnect(false);

      void sandboxStatusQuery.refetch().catch(() => {});
    } catch (error) {
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }
      if (error instanceof SandboxProfilesApiError && error.status < 500) {
        resumeIdempotencyKeyRef.current = null;
      }
      setResumeActionErrorMessage(resolveResumeFailureMessage(error));
    } finally {
      if (
        isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        activeResumeRequestRef.current = null;
        setIsResumingStoppedSandbox(false);
      }
    }
  }, [
    clearLifecycleErrorMessage,
    input.queryClient,
    input.sandboxInstanceId,
    isResumingStoppedSandbox,
    trustedSandboxStatus,
    sandboxStatusQuery.refetch,
  ]);

  return {
    sessionSnapshot,
    sandboxStatusReadState,
    connectionReadiness,
    isResumingStoppedSandbox: isShowingResumeInFlightState,
    requestStoppedSandboxResume,
    sandboxLifecycleStatus: displaySandboxLifecycleStatus,
    sandboxFailureMessage,
    sandboxStatusQuery,
    sessionReconnectState: {
      isRecovering: codexRecoveryState.kind === "recovering",
      message: sessionReconnectMessage,
    },
    shouldAutoResumeOnEntry:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
    lifecycleErrorMessage: resolvedLifecycleErrorMessage,
    stoppedSessionState,
  };
}
