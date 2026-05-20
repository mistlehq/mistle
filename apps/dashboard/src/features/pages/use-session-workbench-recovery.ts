import { useEffect, useReducer, useRef } from "react";

import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";
import type { SessionLifecycleForWorkbench } from "./use-session-workbench-lifecycle-state.js";

const MaxSessionReconnectAttempts = 3;
const SessionReconnectLimitMessage = `Could not reconnect session after ${String(MaxSessionReconnectAttempts)} attempts.`;

type RecoverableSessionDisconnect = {
  id: number;
  message: string;
  targetRuntimeConversationId: string | null;
  recoveryStrategy: "reconnect_transport" | "reopen_stream";
};

type SessionRecoveryReconnectCommand = "none" | "reconnect_transport" | "reopen_stream";

type SessionRecoveryObservedState = {
  canConnect: boolean;
  connected: boolean;
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForTriggerThread: boolean;
  sandboxInstanceId: string | null;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
};

type SessionRecoveryLifecycle = Pick<
  SessionLifecycleForWorkbench,
  "connectSession" | "recoverSession" | "recoverableDisconnect" | "sessionConnectionState"
>;

export type SessionWorkbenchRecoveryState =
  | {
      kind: "idle";
    }
  | {
      kind: "recovering";
      baseMessage: string;
      errorMessage: string | null;
      targetRuntimeConversationId: string | null;
      recoveryStrategy: "reconnect_transport" | "reopen_stream";
      reconnectAttemptCount: number;
      reconnectCommand: SessionRecoveryReconnectCommand;
      recoverableDisconnectId: number;
    };

export type SessionWorkbenchRecoveryEvent =
  | {
      type: "recoverable_disconnect_observed";
      disconnect: RecoverableSessionDisconnect;
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
      observation: SessionRecoveryObservedState;
    };

function createSessionWorkbenchRecoveryStateFromDisconnect(
  disconnect: RecoverableSessionDisconnect,
): SessionWorkbenchRecoveryState {
  return {
    kind: "recovering",
    baseMessage: disconnect.message,
    errorMessage: null,
    targetRuntimeConversationId: disconnect.targetRuntimeConversationId,
    recoveryStrategy: disconnect.recoveryStrategy,
    reconnectAttemptCount: 0,
    reconnectCommand: "none",
    recoverableDisconnectId: disconnect.id,
  };
}

export function reduceSessionWorkbenchRecoveryState(
  state: SessionWorkbenchRecoveryState,
  event: SessionWorkbenchRecoveryEvent,
): SessionWorkbenchRecoveryState {
  switch (state.kind) {
    case "idle": {
      if (event.type === "recoverable_disconnect_observed") {
        return createSessionWorkbenchRecoveryStateFromDisconnect(event.disconnect);
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
              targetRuntimeConversationId: event.disconnect.targetRuntimeConversationId,
              recoveryStrategy: event.disconnect.recoveryStrategy,
            };
          }

          return createSessionWorkbenchRecoveryStateFromDisconnect(event.disconnect);
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

          if (state.reconnectAttemptCount >= MaxSessionReconnectAttempts) {
            return {
              ...state,
              errorMessage: SessionReconnectLimitMessage,
              reconnectCommand: "none",
            };
          }

          if (
            event.observation.sandboxInstanceId === null ||
            !event.observation.canConnect ||
            event.observation.hasLifecycleError ||
            event.observation.isStartingSession ||
            event.observation.isWaitingForTriggerThread ||
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

export function resolveSessionReconnectMessage(input: {
  recoveryBaseMessage: string | null;
  recoveryErrorMessage: string | null;
  reconnectAttemptCount: number;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
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

  return `${input.recoveryBaseMessage} Reconnecting session${input.reconnectAttemptCount > 0 ? ` (attempt ${String(input.reconnectAttemptCount)} of ${String(MaxSessionReconnectAttempts)})` : ""}.`;
}

export function resolveSessionWorkbenchRecoveryStateForRender(input: {
  baseState: SessionWorkbenchRecoveryState;
  canConnect: boolean;
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForTriggerThread: boolean;
  previousSandboxInstanceId: string | null;
  sandboxInstanceId: string | null;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
  sessionConnectionState: SessionRecoveryLifecycle["sessionConnectionState"];
}): SessionWorkbenchRecoveryState {
  const sandboxScopedState =
    input.previousSandboxInstanceId === input.sandboxInstanceId
      ? input.baseState
      : reduceSessionWorkbenchRecoveryState(input.baseState, {
          type: "sandbox_changed",
        });

  return input.sessionConnectionState === "connected"
    ? reduceSessionWorkbenchRecoveryState(sandboxScopedState, {
        type: "session_connected",
      })
    : reduceSessionWorkbenchRecoveryState(sandboxScopedState, {
        type: "sync_observed",
        observation: {
          canConnect: input.canConnect,
          connected: false,
          hasLifecycleError: input.hasLifecycleError,
          isStartingSession: input.isStartingSession,
          isWaitingForTriggerThread: input.isWaitingForTriggerThread,
          sandboxInstanceId: input.sandboxInstanceId,
          sandboxStatus: input.sandboxStatus,
        },
      });
}

export function useSessionWorkbenchRecovery(input: {
  canConnect: boolean;
  connectSession: SessionRecoveryLifecycle["connectSession"];
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForTriggerThread: boolean;
  mainPanelTransitionState: MainPanelTransitionState;
  requestRecoveryStatusRefresh: () => void;
  recoverSession: SessionRecoveryLifecycle["recoverSession"];
  recoverableDisconnect: SessionRecoveryLifecycle["recoverableDisconnect"];
  sandboxInstanceId: string | null;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
  sessionConnectionState: SessionRecoveryLifecycle["sessionConnectionState"];
}) {
  const [sessionRecoveryBaseState, dispatchSessionWorkbenchRecoveryEvent] = useReducer(
    reduceSessionWorkbenchRecoveryState,
    {
      kind: "idle",
    },
  );
  const lastRecoverableDisconnectIdRef = useRef<number | null>(null);
  const previousSandboxInstanceIdRef = useRef(input.sandboxInstanceId);
  const sessionRecoveryState = resolveSessionWorkbenchRecoveryStateForRender({
    baseState: sessionRecoveryBaseState,
    canConnect: input.canConnect,
    hasLifecycleError: input.hasLifecycleError,
    isStartingSession: input.isStartingSession,
    isWaitingForTriggerThread: input.isWaitingForTriggerThread,
    previousSandboxInstanceId: previousSandboxInstanceIdRef.current,
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: input.sandboxStatus,
    sessionConnectionState: input.sessionConnectionState,
  });

  useEffect(() => {
    if (input.recoverableDisconnect === null) {
      return;
    }

    dispatchSessionWorkbenchRecoveryEvent({
      type: "recoverable_disconnect_observed",
      disconnect: input.recoverableDisconnect,
    });
  }, [input.recoverableDisconnect]);

  useEffect(() => {
    if (input.recoverableDisconnect === null) {
      return;
    }

    if (lastRecoverableDisconnectIdRef.current === input.recoverableDisconnect.id) {
      return;
    }

    lastRecoverableDisconnectIdRef.current = input.recoverableDisconnect.id;
    input.requestRecoveryStatusRefresh();
  }, [input.recoverableDisconnect, input.requestRecoveryStatusRefresh]);

  useEffect(() => {
    if (input.sessionConnectionState !== "connected") {
      return;
    }

    dispatchSessionWorkbenchRecoveryEvent({
      type: "session_connected",
    });
  }, [input.sessionConnectionState]);

  useEffect(() => {
    if (input.mainPanelTransitionState !== "stable_chat") {
      return;
    }

    if (sessionRecoveryState.kind !== "recovering") {
      return;
    }

    if (sessionRecoveryState.reconnectCommand === "none") {
      return;
    }

    if (input.sandboxInstanceId === null) {
      return;
    }

    dispatchSessionWorkbenchRecoveryEvent({
      type: "reconnect_attempt_started",
    });
    const recoveryInput = {
      sandboxInstanceId: input.sandboxInstanceId,
      targetRuntimeConversationId: sessionRecoveryState.targetRuntimeConversationId,
    };

    if (sessionRecoveryState.reconnectCommand === "reopen_stream") {
      input.recoverSession(recoveryInput);
      return;
    }

    input.connectSession(
      recoveryInput.targetRuntimeConversationId === null
        ? recoveryInput
        : {
            sandboxInstanceId: recoveryInput.sandboxInstanceId,
            targetRuntimeConversationId: recoveryInput.targetRuntimeConversationId,
          },
    );
  }, [
    sessionRecoveryState,
    input.connectSession,
    input.mainPanelTransitionState,
    input.recoverSession,
    input.sandboxInstanceId,
  ]);

  useEffect(() => {
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;
    dispatchSessionWorkbenchRecoveryEvent({
      type: "sandbox_changed",
    });
    lastRecoverableDisconnectIdRef.current = null;
  }, [input.sandboxInstanceId]);

  const sessionReconnectMessage = resolveSessionReconnectMessage({
    recoveryBaseMessage:
      sessionRecoveryState.kind === "recovering" ? sessionRecoveryState.baseMessage : null,
    recoveryErrorMessage:
      sessionRecoveryState.kind === "recovering" ? sessionRecoveryState.errorMessage : null,
    reconnectAttemptCount:
      sessionRecoveryState.kind === "recovering" ? sessionRecoveryState.reconnectAttemptCount : 0,
    sandboxStatus: input.sandboxStatus,
  });

  return {
    sessionReconnectState: {
      isRecovering: sessionRecoveryState.kind === "recovering",
      message: sessionReconnectMessage,
    },
  };
}
