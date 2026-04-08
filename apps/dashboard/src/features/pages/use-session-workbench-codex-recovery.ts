import { useEffect, useReducer, useRef } from "react";

import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";

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
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
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

  return `${input.recoveryBaseMessage} Reconnecting session${input.reconnectAttemptCount > 0 ? ` (attempt ${String(input.reconnectAttemptCount)} of ${String(MaxCodexReconnectAttempts)})` : ""}.`;
}

export function resolveCodexRecoveryStateForRender(input: {
  baseState: CodexRecoveryState;
  canConnect: boolean;
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForAutomationThread: boolean;
  previousSandboxInstanceId: string | null;
  sandboxInstanceId: string | null;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
  sessionConnectionState: ReturnType<
    typeof useCodexSessionState
  >["lifecycle"]["sessionConnectionState"];
}): CodexRecoveryState {
  const sandboxScopedState =
    input.previousSandboxInstanceId === input.sandboxInstanceId
      ? input.baseState
      : reduceCodexRecoveryState(input.baseState, {
          type: "sandbox_changed",
        });

  return input.sessionConnectionState === "connected"
    ? reduceCodexRecoveryState(sandboxScopedState, {
        type: "session_connected",
      })
    : reduceCodexRecoveryState(sandboxScopedState, {
        type: "sync_observed",
        observation: {
          canConnect: input.canConnect,
          connected: false,
          hasLifecycleError: input.hasLifecycleError,
          isStartingSession: input.isStartingSession,
          isWaitingForAutomationThread: input.isWaitingForAutomationThread,
          sandboxInstanceId: input.sandboxInstanceId,
          sandboxStatus: input.sandboxStatus,
        },
      });
}

export function useSessionWorkbenchCodexRecovery(input: {
  canConnect: boolean;
  connectSession: ReturnType<typeof useCodexSessionState>["lifecycle"]["connectSession"];
  hasLifecycleError: boolean;
  isStartingSession: boolean;
  isWaitingForAutomationThread: boolean;
  mainPanelTransitionState: MainPanelTransitionState;
  markRecoveryBoundary: () => void;
  ptyResetInfo: ReturnType<typeof useSandboxPtyState>["lifecycle"]["resetInfo"];
  recoverSession: ReturnType<typeof useCodexSessionState>["lifecycle"]["recoverSession"];
  recoverableDisconnect: ReturnType<
    typeof useCodexSessionState
  >["lifecycle"]["recoverableDisconnect"];
  refetchSandboxStatus: () => Promise<unknown>;
  sandboxInstanceId: string | null;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
  sessionConnectionState: ReturnType<
    typeof useCodexSessionState
  >["lifecycle"]["sessionConnectionState"];
}) {
  const [codexRecoveryBaseState, dispatchCodexRecoveryEvent] = useReducer(
    reduceCodexRecoveryState,
    {
      kind: "idle",
    },
  );
  const lastRecoverableDisconnectIdRef = useRef<number | null>(null);
  const previousSandboxInstanceIdRef = useRef(input.sandboxInstanceId);
  const codexRecoveryState = resolveCodexRecoveryStateForRender({
    baseState: codexRecoveryBaseState,
    canConnect: input.canConnect,
    hasLifecycleError: input.hasLifecycleError,
    isStartingSession: input.isStartingSession,
    isWaitingForAutomationThread: input.isWaitingForAutomationThread,
    previousSandboxInstanceId: previousSandboxInstanceIdRef.current,
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: input.sandboxStatus,
    sessionConnectionState: input.sessionConnectionState,
  });

  useEffect(() => {
    if (input.recoverableDisconnect === null) {
      return;
    }

    dispatchCodexRecoveryEvent({
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
    input.markRecoveryBoundary();
    void input.refetchSandboxStatus().catch(() => {});
  }, [input.markRecoveryBoundary, input.recoverableDisconnect, input.refetchSandboxStatus]);

  useEffect(() => {
    if (input.ptyResetInfo === null) {
      return;
    }

    input.markRecoveryBoundary();
    void input.refetchSandboxStatus().catch(() => {});
  }, [input.markRecoveryBoundary, input.ptyResetInfo, input.refetchSandboxStatus]);

  useEffect(() => {
    if (input.sessionConnectionState !== "connected") {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "session_connected",
    });
  }, [input.sessionConnectionState]);

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
      input.recoverSession(recoveryInput);
      return;
    }

    input.connectSession(
      recoveryInput.targetThreadId === null
        ? recoveryInput
        : {
            sandboxInstanceId: recoveryInput.sandboxInstanceId,
            targetThreadId: recoveryInput.targetThreadId,
          },
    );
  }, [
    codexRecoveryState,
    input.connectSession,
    input.mainPanelTransitionState,
    input.recoverSession,
    input.sandboxInstanceId,
  ]);

  useEffect(() => {
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;
    dispatchCodexRecoveryEvent({
      type: "sandbox_changed",
    });
    lastRecoverableDisconnectIdRef.current = null;
  }, [input.sandboxInstanceId]);

  const sessionReconnectMessage = resolveCodexReconnectMessage({
    recoveryBaseMessage:
      codexRecoveryState.kind === "recovering" ? codexRecoveryState.baseMessage : null,
    recoveryErrorMessage:
      codexRecoveryState.kind === "recovering" ? codexRecoveryState.errorMessage : null,
    reconnectAttemptCount:
      codexRecoveryState.kind === "recovering" ? codexRecoveryState.reconnectAttemptCount : 0,
    sandboxStatus: input.sandboxStatus,
  });

  return {
    sessionReconnectState: {
      isRecovering: codexRecoveryState.kind === "recovering",
      message: sessionReconnectMessage,
    },
  };
}
