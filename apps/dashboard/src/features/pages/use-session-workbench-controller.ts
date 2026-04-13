import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useSessionComposerAttachmentControl,
  useSessionComposerConfigControl,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
  shouldWaitForAutomationSessionThread,
} from "./session-workbench-state.js";
import type { SessionWorkbenchStatus } from "./session-workbench-state.js";
import { useSessionBranchDiff } from "./use-session-branch-diff.js";
import { useSessionDiffWorkbenchState } from "./use-session-diff-workbench-state.js";
import { useSessionMainPanelHandoff } from "./use-session-main-panel-handoff.js";
import { useSessionPortAccess } from "./use-session-port-access.js";
import { useSessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import {
  reduceCodexRecoveryState,
  resolveCodexRecoveryStateForRender,
  resolveCodexReconnectMessage,
} from "./use-session-workbench-codex-recovery.js";
import {
  getSandboxInstanceStatusQueryKey,
  useSessionWorkbenchLifecycleState,
} from "./use-session-workbench-lifecycle-state.js";
import { useSessionWorkbenchTransport } from "./use-session-workbench-transport.js";

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
  stoppedSessionMessage: string | null;
  workbenchStatus: SessionWorkbenchStatus;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxLifecycleStatus: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sandboxLifecycleStatus"];
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  lifecycleStep: ReturnType<typeof useCodexSessionState>["lifecycle"]["step"];
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
  diffPanelState: {
    closePanel: () => void;
    errorMessage: string | null;
    isLoading: boolean;
    isVisible: boolean;
    openPanel: () => void;
    panelSize: number;
    patch: string;
    setPanelSize: (size: number) => void;
    togglePanel: () => void;
  };
  primaryRepositoryState: ReturnType<typeof useSessionPrimaryRepositoryState>;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    isSwitching: boolean;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  portAccessState: ReturnType<typeof useSessionPortAccess>;
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
  resolveSandboxStatusReadState,
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexRecoveryStateForRender,
  resolveCodexReconnectMessage,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
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
  const transportManager = useSessionWorkbenchTransport({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const sessionClientRef = useRef<AgentStreamClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);
  const selectedRepositoryPathRef = useRef<string | null>(null);
  const sessionState = useCodexSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sessionClientRef,
    rpcClientRef,
    sessionEventUnsubscribersRef,
  });
  const ptyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const cliPtyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const diffPanelState = useSessionDiffWorkbenchState({
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
    selectedRepositoryPathRef,
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
  const primaryRepositoryState = useSessionPrimaryRepositoryState({
    enabled: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  selectedRepositoryPathRef.current = primaryRepositoryState.selectedRepositoryPath;
  const isPrimaryRepositorySwitchBlockedByCli = handoff.isCliToggleActive;
  const isSwitchingPrimaryRepository = sessionState.threads.isSwitchingPrimaryRepository;
  const branchDiffState = useSessionBranchDiff({
    cwd: primaryRepositoryState.selectedRepositoryPath,
    enabled: diffPanelState.isVisible && workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const portAccessState = useSessionPortAccess({
    canConnect: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
    stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
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
          ? (workbenchLifecycleState.stoppedSessionMessage ??
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
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const switchPrimaryRepository = useCallback(
    async (nextSelectedRepositoryPath: string | null): Promise<void> => {
      if (nextSelectedRepositoryPath === primaryRepositoryState.selectedRepositoryPath) {
        return;
      }

      await sessionState.threads.switchPrimaryRepository(nextSelectedRepositoryPath);
      primaryRepositoryState.setSelectedRepositoryPath(nextSelectedRepositoryPath);
    },
    [
      primaryRepositoryState.selectedRepositoryPath,
      primaryRepositoryState.setSelectedRepositoryPath,
      sessionState.threads.switchPrimaryRepository,
    ],
  );

  return {
    workbench: {
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
      workbenchStatus: workbenchLifecycleState.workbenchStatus,
      ptyState,
      cliPtyState,
      sandboxLifecycleStatus: workbenchLifecycleState.sandboxLifecycleStatus,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      lifecycleStep: lifecycle.step,
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
      diffPanelState: {
        closePanel: diffPanelState.closePanel,
        errorMessage: branchDiffState.errorMessage,
        isLoading: branchDiffState.isLoading,
        isVisible: diffPanelState.isVisible,
        openPanel: diffPanelState.openPanel,
        panelSize: diffPanelState.panelSize,
        patch: branchDiffState.patch,
        setPanelSize: diffPanelState.setPanelSize,
        togglePanel: diffPanelState.togglePanel,
      },
      primaryRepositoryState,
      portAccessState,
      primaryRepositoryControlState: {
        disabledReason: isPrimaryRepositorySwitchBlockedByCli
          ? "Exit Codex CLI before switching the primary repository."
          : null,
        isSwitching: isSwitchingPrimaryRepository,
        switchPrimaryRepository,
      },
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
