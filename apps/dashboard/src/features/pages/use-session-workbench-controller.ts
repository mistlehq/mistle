import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useOpenCodeSessionState } from "../session-agents/opencode/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  useCodexWorkbenchComposerState,
  useOpenCodeWorkbenchComposerState,
} from "../session-agents/session-workbench-composer-bootstrap.js";
import {
  buildCodexConversationRuntime,
  buildOpenCodeConversationRuntime,
  type SessionWorkbenchRuntimeAdapter,
} from "../session-agents/session-workbench-conversation-runtimes.js";
import {
  buildCodexHandoffRuntime,
  buildCodexLifecycleForHandoff,
  buildOpenCodeHandoffRuntime,
  buildOpenCodeLifecycleForHandoff,
  buildOpenCodeLifecycleForWorkbench,
  resolveSessionLifecycleForWorkbench,
} from "../session-agents/session-workbench-handoff-runtimes.js";
import {
  buildCodexTurnStarter,
  buildOpenCodeTurnStarter,
} from "../session-agents/session-workbench-turn-starters.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useSessionComposerAttachmentControl,
  type SessionComposerSharedInput,
  type SessionComposerStateInput,
  type SessionTurnControl,
} from "./session-composer/index.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  resolveInitialSelectedRepositoryPath,
  resolveSessionTerminalCwd,
} from "./session-primary-repository-policy.js";
import type { SessionStartupState } from "./session-startup-status.js";
import type {
  SessionTerminalContentInset,
  SessionTerminalThemeMode,
} from "./session-terminal-surface.js";
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
import {
  useSessionMainPanelHandoff,
  type SessionMainPanelRuntimeId,
} from "./use-session-main-panel-handoff.js";
import { useSessionPortAccess } from "./use-session-port-access.js";
import { useSessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";
import { useSessionRepositoryStatus } from "./use-session-repository-status.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import { useSessionWorkbenchLifecycleState } from "./use-session-workbench-lifecycle-state.js";
import { useSessionWorkbenchTransport } from "./use-session-workbench-transport.js";

type SessionWorkbenchState = {
  terminalCwd: string;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
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
  handleTerminalWorkspaceReset: () => void;
  stoppedSessionMessage: string | null;
  workbenchStatus: SessionWorkbenchStatus;
  sandboxLifecycleStatus: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sandboxLifecycleStatus"];
  initialEntryStartupState: SessionStartupState | null;
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  primaryPanelState: {
    transitionState: MainPanelTransitionState;
    canEnterCli: boolean;
    disabledReason: string | null;
    error: ReturnType<typeof useSessionMainPanelHandoff>["error"];
    isCliToggleActive: boolean;
    showsChatComposer: boolean;
    cliTerminalContentInset: SessionTerminalContentInset;
    cliTerminalThemeMode: SessionTerminalThemeMode;
    cliRuntimeDisplayName: string;
    enterCliMode: () => Promise<void>;
    exitCliMode: () => Promise<void>;
  };
  terminalPanelState: {
    closePanel: () => void;
    isVisible: boolean;
    openPanel: () => void;
    togglePanel: () => void;
  };
  diffPanelState: {
    closePanel: () => void;
    compareLabel: string;
    errorNotice: ReturnType<typeof useSessionBranchDiff>["errorNotice"];
    isLoading: boolean;
    isVisible: boolean;
    openPanel: () => void;
    patch: string;
    togglePanel: () => void;
  };
  primaryRepositoryState: ReturnType<typeof useSessionPrimaryRepositoryState>;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  portAccessState: ReturnType<typeof useSessionPortAccess>;
};

type SessionConversationPaneState = SessionWorkbenchRuntimeAdapter["conversation"] & {
  composerStateInput: SessionComposerStateInput;
  serverRequestsState: SessionWorkbenchRuntimeAdapter["serverRequestsState"];
};

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;

type UseSessionWorkbenchControllerResult = {
  workbench: SessionWorkbenchState;
  conversationPane: SessionConversationPaneState;
};

export {
  sandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
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
  const activeHandoffRuntimeIdRef = useRef<SessionMainPanelRuntimeId>(
    CodexWorkbenchCapabilities.runtimeId,
  );
  const selectedRepositoryPathRef = useRef<string | null>(null);
  const sessionState = useCodexSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sessionClientRef,
    rpcClientRef,
    sessionEventUnsubscribersRef,
  });
  const lifecycle = sessionState.lifecycle;
  const openCodeSessionState = useOpenCodeSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const openCodeLifecycle = openCodeSessionState.lifecycle;
  const codexLifecycleForHandoff = useMemo(
    () => buildCodexLifecycleForHandoff(lifecycle),
    [
      lifecycle.clearLifecycleErrorMessage,
      lifecycle.connectSession,
      lifecycle.detachSessionConnection,
      lifecycle.lifecycleErrorMessage,
      lifecycle.sessionConnectionState,
      lifecycle.sessionSnapshot,
    ],
  );
  const openCodeLifecycleForHandoff = useMemo(
    () => buildOpenCodeLifecycleForHandoff(openCodeLifecycle),
    [
      openCodeLifecycle.clearLifecycleErrorMessage,
      openCodeLifecycle.connectSession,
      openCodeLifecycle.detachSessionConnection,
      openCodeLifecycle.lifecycleErrorMessage,
      openCodeLifecycle.sessionConnectionState,
      openCodeLifecycle.sessionSnapshot,
    ],
  );
  const openCodeLifecycleForWorkbench = useMemo(
    () => buildOpenCodeLifecycleForWorkbench(openCodeLifecycle),
    [
      openCodeLifecycle.clearLifecycleErrorMessage,
      openCodeLifecycle.connectSession,
      openCodeLifecycle.detachSessionConnection,
      openCodeLifecycle.disconnectSession,
      openCodeLifecycle.isStartingSession,
      openCodeLifecycle.lifecycleErrorMessage,
      openCodeLifecycle.recoverSession,
      openCodeLifecycle.recoverableDisconnect,
      openCodeLifecycle.sessionConnectionState,
      openCodeLifecycle.sessionSnapshot,
    ],
  );
  const resolveLifecycleForWorkbench = useCallback(
    (agentRuntimeId: string | null) =>
      resolveSessionLifecycleForWorkbench({
        agentRuntimeId,
        codexLifecycle: lifecycle,
        openCodeLifecycle: openCodeLifecycleForWorkbench,
      }),
    [lifecycle, openCodeLifecycleForWorkbench],
  );
  const contextUsage =
    sessionState.threadTokenUsageSnapshot?.threadId ===
    sessionState.lifecycle.sessionSnapshot?.activeThreadId
      ? formatCodexContextUsage(sessionState.threadTokenUsageSnapshot)
      : null;
  const cliPtyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const diffPanelState = useSessionDiffWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const chat = sessionState.chat;
  const serverRequests = sessionState.serverRequests;
  const sessionMessage = sessionState.sessionMessage;
  const codexHandoffRuntime = useMemo(
    () =>
      buildCodexHandoffRuntime({
        chat,
        lifecycle: codexLifecycleForHandoff,
        serverRequests,
        threadAuthority: sessionState.threadAuthority,
      }),
    [
      chat.hydrateChatFromThread,
      codexLifecycleForHandoff,
      serverRequests.resetServerRequests,
      sessionState.threadAuthority.clearActiveThreadIdAfterCliLaunch,
      sessionState.threadAuthority.providerThreadId,
      sessionState.threadAuthority.resolveCliLaunchTarget,
    ],
  );
  const openCodeHandoffRuntime = useMemo(
    () =>
      buildOpenCodeHandoffRuntime({
        chat: openCodeSessionState.chat,
        lifecycle: openCodeLifecycleForHandoff,
        sessionSnapshot: openCodeSessionState.lifecycle.sessionSnapshot,
      }),
    [
      openCodeLifecycleForHandoff,
      openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      openCodeSessionState.lifecycle.sessionSnapshot,
    ],
  );
  const handoffRuntimes = useMemo(
    () => ({
      [CodexWorkbenchCapabilities.runtimeId]: codexHandoffRuntime,
      [OpenCodeWorkbenchCapabilities.runtimeId]: openCodeHandoffRuntime,
    }),
    [codexHandoffRuntime, openCodeHandoffRuntime],
  );

  const handoff = useSessionMainPanelHandoff({
    activeRuntimeIdRef: activeHandoffRuntimeIdRef,
    cliPtyState,
    runtimes: handoffRuntimes,
    selectedRepositoryPathRef,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const workbenchLifecycleState = useSessionWorkbenchLifecycleState({
    sandboxInstanceId: input.sandboxInstanceId,
    mainPanelTransitionState: handoff.transitionState,
    resolveLifecycle: resolveLifecycleForWorkbench,
    queryClient,
  });
  const sandboxStatus = workbenchLifecycleState.sandboxStatusQuery.data;
  const isOpenCodeRuntime =
    sandboxStatus?.runtimeContext?.agentRuntimeId === OpenCodeWorkbenchCapabilities.runtimeId;
  const activeRuntimeCapabilities = isOpenCodeRuntime
    ? OpenCodeWorkbenchCapabilities
    : CodexWorkbenchCapabilities;
  activeHandoffRuntimeIdRef.current = activeRuntimeCapabilities.runtimeId;
  const activeThreadCwd = isOpenCodeRuntime
    ? null
    : sessionState.lifecycle.sessionSnapshot?.activeThreadCwd;
  const initialSelectedRepositoryPath = resolveInitialSelectedRepositoryPath({
    activeThreadCwd: activeThreadCwd ?? undefined,
    runtimePrimaryRepositoryRoot: sandboxStatus?.runtimeContext?.primaryRepositoryRoot,
  });
  const primaryRepositoryState = useSessionPrimaryRepositoryState({
    enabled: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    initialSelectedRepositoryPath,
    runtimeDisplayName: activeRuntimeCapabilities.displayName,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const selectedRepositoryPath = primaryRepositoryState.selectedRepositoryPath;
  selectedRepositoryPathRef.current = selectedRepositoryPath;
  const terminalCwd = resolveSessionTerminalCwd({
    activeThreadCwd,
    selectedRepositoryPath,
  });
  const isPrimaryRepositorySwitchBlockedByCli = handoff.isCliToggleActive;
  const branchDiffState = useSessionBranchDiff({
    cwd: selectedRepositoryPath,
    enabled: diffPanelState.isVisible && workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const repositoryStatus = useSessionRepositoryStatus({
    connectedAtIso: workbenchLifecycleState.sessionSnapshot?.connectedAtIso ?? null,
    cwd: selectedRepositoryPath,
    enabled: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    refreshEpoch: sessionState.repositoryStatusRefreshEpoch,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const portAccessState = useSessionPortAccess({
    canConnect: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
    stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
  });
  const { bootstrap: openCodeComposerBootstrap, configControl: openCodeConfigControl } =
    useOpenCodeWorkbenchComposerState({
      enabled: isOpenCodeRuntime,
      sandboxInstanceId: input.sandboxInstanceId,
      selectedRepositoryPath,
      sessionState: openCodeSessionState,
    });
  const { configControl } = useCodexWorkbenchComposerState({
    sessionState,
  });
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const activeSessionThreadId = isOpenCodeRuntime
    ? null
    : (sessionSnapshot?.activeThreadId ?? null);
  const activeConversationId = isOpenCodeRuntime
    ? (openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null)
    : activeSessionThreadId;
  const enterCliDisabledReason =
    input.sandboxInstanceId === null
      ? "Session id is required."
      : sessionSnapshot === null
        ? "TUI is available after the session is connected."
        : !workbenchLifecycleState.connectionReadiness.canConnect
          ? (workbenchLifecycleState.stoppedSessionMessage ??
            "TUI is available only when the sandbox is running.")
          : handoff.transitionState !== "stable_chat"
            ? `Finish the current primary-panel transition before opening ${activeRuntimeCapabilities.displayName} TUI.`
            : null;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null && sessionSnapshot !== null && activeConversationId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: activeConversationId,
          }
        : null,
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const switchPrimaryRepository = useCallback(
    async (nextSelectedRepositoryPath: string | null): Promise<void> => {
      if (nextSelectedRepositoryPath === selectedRepositoryPath) {
        return;
      }

      if (!isOpenCodeRuntime) {
        await sessionState.threads.ensureCanSwitchPrimaryRepository();
      }
      primaryRepositoryState.setSelectedRepositoryPath(nextSelectedRepositoryPath);
    },
    [
      isOpenCodeRuntime,
      primaryRepositoryState.setSelectedRepositoryPath,
      selectedRepositoryPath,
      sessionState.threads.ensureCanSwitchPrimaryRepository,
    ],
  );
  const startCodexTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildCodexTurnStarter({
        cachedTitle: sandboxStatus?.title,
        chat,
        ensureTransportConnected: transportManager.ensureTransportConnected,
        queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath,
      }),
    [
      chat,
      input.sandboxInstanceId,
      queryClient,
      sandboxStatus?.title,
      selectedRepositoryPath,
      transportManager.ensureTransportConnected,
    ],
  );
  const startOpenCodeTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildOpenCodeTurnStarter({
        cachedTitle: sandboxStatus?.title,
        chat: openCodeSessionState.chat,
        modelSelection: {
          hasExplicitModelSelection: openCodeConfigControl.hasExplicitModelSelection,
          selectedModel: openCodeConfigControl.selectedModel,
        },
        queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath,
      }),
    [
      input.sandboxInstanceId,
      openCodeConfigControl.hasExplicitModelSelection,
      openCodeConfigControl.selectedModel,
      openCodeSessionState.chat,
      openCodeSessionState.chat.chatState.messageOrder.length,
      queryClient,
      sandboxStatus?.title,
      selectedRepositoryPath,
    ],
  );
  const codexRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () =>
      buildCodexConversationRuntime({
        activeConversationId: activeSessionThreadId,
        bootstrap: sessionState.bootstrap,
        chat,
        configControl,
        contextUsage,
        serverRequests,
        sessionMessage,
        startTurn: startCodexTurn,
      }),
    [
      activeSessionThreadId,
      chat.canInterruptTurn,
      chat.canSteerTurn,
      chat.chatState,
      chat.dismissUserMessageAction,
      chat.interruptTurn,
      chat.isInterruptingTurn,
      chat.isStartingTurn,
      chat.isSteeringTurn,
      chat.steerTurn,
      configControl,
      contextUsage,
      serverRequests.isRespondingToServerRequest,
      serverRequests.pendingServerRequests,
      serverRequests.respondToServerRequest,
      sessionMessage.clearSessionErrorMessage,
      sessionMessage.sessionErrorMessage,
      sessionState.bootstrap,
      startCodexTurn,
    ],
  );
  const openCodeRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () =>
      buildOpenCodeConversationRuntime({
        bootstrap: openCodeComposerBootstrap,
        chat: openCodeSessionState.chat,
        configControl: openCodeConfigControl,
        sessionMessage: openCodeSessionState.sessionMessage,
        sessionSnapshot: openCodeSessionState.lifecycle.sessionSnapshot,
        startTurn: startOpenCodeTurn,
      }),
    [
      openCodeComposerBootstrap,
      openCodeConfigControl,
      openCodeSessionState.chat.abortSession,
      openCodeSessionState.chat.canInterruptTurn,
      openCodeSessionState.chat.chatState,
      openCodeSessionState.chat.isInterruptingTurn,
      openCodeSessionState.chat.isRespondingToPermission,
      openCodeSessionState.chat.isStartingTurn,
      openCodeSessionState.chat.respondToPermission,
      openCodeSessionState.lifecycle.sessionSnapshot,
      openCodeSessionState.sessionMessage.clearSessionErrorMessage,
      openCodeSessionState.sessionMessage.reportSessionErrorMessage,
      openCodeSessionState.sessionMessage.sessionErrorMessage,
      startOpenCodeTurn,
    ],
  );
  const activeRuntime = isOpenCodeRuntime ? openCodeRuntime : codexRuntime;
  const sharedComposerInput: SessionComposerSharedInput = {
    attachmentControl,
    repositoryStatus,
  };

  return {
    workbench: {
      terminalCwd,
      ensureTransportConnected: transportManager.ensureTransportConnected,
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      handleTerminalWorkspaceReset: workbenchLifecycleState.handleTerminalWorkspaceReset,
      stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
      workbenchStatus: workbenchLifecycleState.workbenchStatus,
      cliPtyState,
      sandboxLifecycleStatus: workbenchLifecycleState.sandboxLifecycleStatus,
      initialEntryStartupState: workbenchLifecycleState.initialEntryStartupState,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      primaryPanelState: {
        transitionState: handoff.transitionState,
        canEnterCli: enterCliDisabledReason === null,
        disabledReason: enterCliDisabledReason,
        error: handoff.error,
        isCliToggleActive: handoff.isCliToggleActive,
        showsChatComposer: handoff.transitionState === "stable_chat",
        cliTerminalContentInset: activeRuntime.cliTerminalContentInset,
        cliTerminalThemeMode: "system",
        cliRuntimeDisplayName: activeRuntime.displayName,
        enterCliMode: handoff.handoffToCli,
        exitCliMode: handoff.handoffToChat,
      },
      terminalPanelState,
      diffPanelState: {
        closePanel: diffPanelState.closePanel,
        compareLabel: branchDiffState.compareLabel,
        errorNotice: branchDiffState.errorNotice,
        isLoading: branchDiffState.isLoading,
        isVisible: diffPanelState.isVisible,
        openPanel: diffPanelState.openPanel,
        patch: branchDiffState.patch,
        togglePanel: diffPanelState.togglePanel,
      },
      primaryRepositoryState,
      portAccessState,
      primaryRepositoryControlState: {
        disabledReason:
          !isOpenCodeRuntime && isPrimaryRepositorySwitchBlockedByCli
            ? "Exit Codex TUI before switching the primary repository."
            : null,
        switchPrimaryRepository,
      },
    },
    conversationPane: {
      activeConversationId: activeRuntime.conversation.activeConversationId,
      chatState: activeRuntime.conversation.chatState,
      ...(activeRuntime.conversation.dismissUserMessageAction === undefined
        ? {}
        : { dismissUserMessageAction: activeRuntime.conversation.dismissUserMessageAction }),
      composerStateInput: {
        ...activeRuntime.composerRuntimeInput,
        ...sharedComposerInput,
      },
      serverRequestsState: activeRuntime.serverRequestsState,
    },
  };
}
