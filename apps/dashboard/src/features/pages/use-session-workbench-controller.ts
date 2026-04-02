import { useQueryClient } from "@tanstack/react-query";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useSessionComposerAttachmentControl,
  useSessionComposerConfigControl,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import { useSessionMainPanelHandoff } from "./use-session-main-panel-handoff.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  isActiveResumeRequest,
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexReconnectMessage,
  resolveSessionEntryPhase,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchLifecycleState,
} from "./use-session-workbench-lifecycle-state.js";

type SessionWorkbenchState = {
  connectionReadiness: {
    canConnect: boolean;
    reason:
      | "failed"
      | "loading"
      | "missing-session"
      | "ready"
      | "resuming"
      | "starting"
      | "stopped"
      | "unknown";
  };
  stoppedSessionState: {
    message: string | null;
    requiresManualResume: boolean;
  };
  hasTopAlert: boolean;
  isResumingStoppedSandbox: boolean;
  sessionReconnectState: {
    isRecovering: boolean;
    message: string | null;
  };
  shouldAutoResumeOnEntry: boolean;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  requestStoppedSandboxResume: () => Promise<void>;
  sandboxLifecycleStatus: "resuming" | "starting" | "running" | "stopped" | "failed" | null;
  sandboxFailureMessage: string | null;
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  sandboxHeaderStatusUi: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sandboxHeaderStatusUi"];
  lifecycleStep: ReturnType<typeof useCodexSessionState>["lifecycle"]["step"];
  lifecycleErrorMessage: string | null;
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  primaryPanelState: {
    transitionState: MainPanelTransitionState;
    canEnterCli: boolean;
    disabledReason: string | null;
    error: ReturnType<typeof useSessionMainPanelHandoff>["error"];
    isCliToggleActive: boolean;
    showsChatComposer: boolean;
    enterCliMode: () => Promise<void>;
    exitCliMode: () => Promise<void>;
  };
  terminalPanelState: {
    closePanel: () => void;
    isVisible: boolean;
    openPanel: () => void;
    panelSize: number;
    setPanelSize: (size: number) => void;
    togglePanel: () => void;
  };
};

type SessionConversationPaneState = {
  chatState: ReturnType<typeof useCodexSessionState>["chat"]["chatState"];
  composerStateInput: SessionComposerStateInput;
  serverRequestsState: {
    isRespondingToServerRequest: boolean;
    pendingServerRequests: ReturnType<
      typeof useCodexSessionState
    >["serverRequests"]["pendingServerRequests"];
    respondToServerRequest: (requestId: string | number, result: unknown) => void;
  };
};

type UseSessionWorkbenchControllerResult = {
  workbench: SessionWorkbenchState;
  conversationPane: SessionConversationPaneState;
};

export {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  isActiveResumeRequest,
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexReconnectMessage,
  resolveSessionEntryPhase,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
};
export type {
  SessionConversationPaneState,
  SessionWorkbenchState,
  UseSessionWorkbenchControllerResult,
};

export function useSessionWorkbenchController(input: {
  sandboxInstanceId: string | null;
}): UseSessionWorkbenchControllerResult {
  const queryClient = useQueryClient();
  const sessionState = useCodexSessionState();
  const ptyState = useSandboxPtyState();
  const cliPtyState = useSandboxPtyState();
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const lifecycle = sessionState.lifecycle;
  const chat = sessionState.chat;
  const codexConfig = sessionState.codexConfig;
  const serverRequests = sessionState.serverRequests;
  const sessionMessage = sessionState.sessionMessage;

  const handoff = useSessionMainPanelHandoff({
    cliPtyState,
    chat,
    lifecycle,
    sandboxInstanceId: input.sandboxInstanceId,
    serverRequests,
    threadAuthority: sessionState.threadAuthority,
  });

  const workbenchLifecycleState = useSessionWorkbenchLifecycleState({
    sandboxInstanceId: input.sandboxInstanceId,
    mainPanelTransitionState: handoff.transitionState,
    lifecycle,
    ptyState,
    queryClient,
  });
  const configControl = useSessionComposerConfigControl({
    bootstrap: sessionState.bootstrap,
    clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
    codexConfig,
  });
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const enterCliDisabledReason =
    input.sandboxInstanceId === null
      ? "Session id is required."
      : sessionSnapshot === null
        ? "CLI is available after the session is connected."
        : !workbenchLifecycleState.connectionReadiness.canConnect
          ? (workbenchLifecycleState.stoppedSessionState.message ??
            "CLI is available only when the sandbox is running.")
          : handoff.transitionState !== "stable_chat"
            ? "Finish the current primary-panel transition before opening Codex CLI."
            : null;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null &&
      sessionSnapshot !== null &&
      sessionSnapshot.activeThreadId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: sessionSnapshot.activeThreadId,
          }
        : null,
  });

  return {
    workbench: {
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      stoppedSessionState: workbenchLifecycleState.stoppedSessionState,
      hasTopAlert: workbenchLifecycleState.hasTopAlert,
      isResumingStoppedSandbox: workbenchLifecycleState.isResumingStoppedSandbox,
      sessionReconnectState: workbenchLifecycleState.sessionReconnectState,
      shouldAutoResumeOnEntry: workbenchLifecycleState.shouldAutoResumeOnEntry,
      ptyState,
      cliPtyState,
      requestStoppedSandboxResume: workbenchLifecycleState.requestStoppedSandboxResume,
      sandboxLifecycleStatus: workbenchLifecycleState.sandboxLifecycleStatus,
      sandboxFailureMessage: workbenchLifecycleState.sandboxFailureMessage,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      sandboxHeaderStatusUi: workbenchLifecycleState.sandboxHeaderStatusUi,
      lifecycleStep: lifecycle.step,
      lifecycleErrorMessage: workbenchLifecycleState.lifecycleErrorMessage,
      primaryPanelState: {
        transitionState: handoff.transitionState,
        canEnterCli: enterCliDisabledReason === null,
        disabledReason: enterCliDisabledReason,
        error: handoff.error,
        isCliToggleActive: handoff.isCliToggleActive,
        showsChatComposer: handoff.transitionState === "stable_chat",
        enterCliMode: handoff.handoffToCli,
        exitCliMode: handoff.handoffToChat,
      },
      terminalPanelState,
    },
    conversationPane: {
      chatState: chat.chatState,
      composerStateInput: {
        bootstrap: sessionState.bootstrap,
        configControl,
        attachmentControl,
        turnControl: {
          activeTurnState: chat.canInterruptTurn || chat.canSteerTurn ? "running" : "idle",
          canInterrupt: chat.canInterruptTurn,
          canSteer: chat.canSteerTurn,
          completedTurnErrorMessage: chat.chatState.completedErrorMessage,
          interruptTurn: chat.interruptTurn,
          isInterrupting: chat.isInterruptingTurn,
          isStarting: chat.isStartingTurn,
          isSteering: chat.isSteeringTurn,
          startTurn: chat.startTurn,
          steerTurn: chat.steerTurn,
        },
        sessionErrorMessage: sessionMessage.sessionErrorMessage,
        clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
      },
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    },
  };
}
