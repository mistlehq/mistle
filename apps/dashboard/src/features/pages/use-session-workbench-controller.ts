import { useQueryClient } from "@tanstack/react-query";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import type { SessionConversationComposerProps } from "./session-conversation-pane.tsx";
import { useSessionConversationComposerState } from "./use-session-conversation-composer-state.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  isActiveResumeRequest,
  resolveAutomationSessionPreparationTimeoutDelayMs,
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
  shouldAutoResumeOnEntry: boolean;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  requestStoppedSandboxResume: () => Promise<void>;
  sandboxFailureMessage: string | null;
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  sessionHeaderStatusUi: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sessionHeaderStatusUi"];
  startErrorMessage: string | null;
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
  composerProps: SessionConversationComposerProps;
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
  isActiveResumeRequest,
  resolveAutomationSessionPreparationTimeoutDelayMs,
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
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const lifecycle = sessionState.lifecycle;
  const chat = sessionState.chat;
  const admin = sessionState.admin;
  const serverRequests = sessionState.serverRequests;
  const hasActiveTurn = chat.canInterruptTurn || chat.canSteerTurn;

  const workbenchLifecycleState = useSessionWorkbenchLifecycleState({
    sandboxInstanceId: input.sandboxInstanceId,
    lifecycle,
    ptyState,
    queryClient,
  });

  const composerProps = useSessionConversationComposerState({
    admin,
    chat: {
      canInterruptTurn: chat.canInterruptTurn,
      canSteerTurn: chat.canSteerTurn,
      completedErrorMessage: chat.chatState.completedErrorMessage,
      interruptTurn: chat.interruptTurn,
      isInterruptingTurn: chat.isInterruptingTurn,
      isStartingTurn: chat.isStartingTurn,
      isSteeringTurn: chat.isSteeringTurn,
      startTurn: chat.startTurn,
      steerTurn: chat.steerTurn,
    },
    connectedSession: workbenchLifecycleState.connectedSession,
    hasActiveTurn,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  return {
    workbench: {
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      stoppedSessionState: workbenchLifecycleState.stoppedSessionState,
      hasTopAlert: workbenchLifecycleState.hasTopAlert,
      isResumingStoppedSandbox: workbenchLifecycleState.isResumingStoppedSandbox,
      shouldAutoResumeOnEntry: workbenchLifecycleState.shouldAutoResumeOnEntry,
      ptyState,
      requestStoppedSandboxResume: workbenchLifecycleState.requestStoppedSandboxResume,
      sandboxFailureMessage: workbenchLifecycleState.sandboxFailureMessage,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      sessionHeaderStatusUi: workbenchLifecycleState.sessionHeaderStatusUi,
      startErrorMessage: workbenchLifecycleState.startErrorMessage,
      terminalPanelState,
    },
    conversationPane: {
      chatState: chat.chatState,
      composerProps,
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    },
  };
}
