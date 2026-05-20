import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import type { UseCodexSessionStateResult } from "../session-agents/codex/session-state/index.js";
import type { UseOpenCodeSessionStateResult } from "../session-agents/opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "../session-agents/pi/session-state/index.js";
import {
  useCodexWorkbenchComposerState,
  useOpenCodeWorkbenchComposerState,
  usePiWorkbenchComposerState,
} from "../session-agents/session-workbench-composer-bootstrap.js";
import {
  buildCodexConversationRuntime,
  buildOpenCodeConversationRuntime,
  buildPiConversationRuntime,
  type SessionWorkbenchRuntimeAdapter,
} from "../session-agents/session-workbench-conversation-runtimes.js";
import {
  buildCodexTurnStarter,
  buildOpenCodeTurnStarter,
  buildPiTurnQueuer,
  buildPiTurnStarter,
  buildPiTurnSteerer,
} from "../session-agents/session-workbench-turn-starters.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import {
  useSessionComposerAttachmentControl,
  type SessionComposerSharedInput,
  type SessionComposerStateInput,
  type SessionTurnControl,
} from "./session-composer/index.js";
import type { SessionTerminalContentInset } from "./session-terminal-surface.js";
import type { useSessionWorkbenchLifecycleState } from "./use-session-workbench-lifecycle-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

export type SessionConversationPaneState = SessionWorkbenchRuntimeAdapter["conversation"] & {
  composerStateInput: SessionComposerStateInput;
  serverRequestsState: SessionWorkbenchRuntimeAdapter["serverRequestsState"];
  codexThreadNavigator: {
    activeThreadCwd: string | null;
    activeThreadId: string | null;
    providerThreadId: string | null;
    availableThreads: UseCodexSessionStateResult["threads"]["availableThreads"];
    hasMoreAvailableThreads: boolean;
    originalThreadId: string | null;
    pendingThreadId: string | null;
    isStartingNewThread: boolean;
    refreshThreadList: () => void;
    resumeThread: (threadId: string) => Promise<string>;
    startNewThread: (input?: { cwd?: string }) => Promise<string>;
  } | null;
};

type SessionWorkbenchConversationRuntimeState = {
  cliRuntimeDisplayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  conversationPane: SessionConversationPaneState;
};

export function useSessionWorkbenchConversationRuntime(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  isOpenCodeRuntime: boolean;
  isPiRuntime: boolean;
  openCodeSessionState: UseOpenCodeSessionStateResult;
  piSessionState: UsePiSessionStateResult;
  queryClient: QueryClient;
  repositoryStatus: SessionComposerSharedInput["repositoryStatus"];
  sandboxInstanceId: string | null;
  sandboxStatus: SandboxInstanceStatusResult | undefined;
  selectedRepositoryPath: string | null;
  sessionSnapshot: ReturnType<typeof useSessionWorkbenchLifecycleState>["sessionSnapshot"];
  sessionState: UseCodexSessionStateResult;
}): SessionWorkbenchConversationRuntimeState {
  const { sessionState, openCodeSessionState } = input;
  const chat = sessionState.chat;
  const serverRequests = sessionState.serverRequests;
  const sessionMessage = sessionState.sessionMessage;
  const { bootstrap: openCodeComposerBootstrap, configControl: openCodeConfigControl } =
    useOpenCodeWorkbenchComposerState({
      enabled: input.isOpenCodeRuntime,
      sandboxInstanceId: input.sandboxInstanceId,
      selectedRepositoryPath: input.selectedRepositoryPath,
      sessionState: openCodeSessionState,
    });
  const { bootstrap: piComposerBootstrap, configControl: piConfigControl } =
    usePiWorkbenchComposerState({
      sandboxInstanceId: input.sandboxInstanceId,
      sessionState: input.piSessionState,
    });
  const { configControl } = useCodexWorkbenchComposerState({
    sessionState,
  });
  const activeRuntimeConversationId =
    input.isOpenCodeRuntime || input.isPiRuntime
      ? null
      : (input.sessionSnapshot?.activeRuntimeConversationId ?? null);
  const contextUsage =
    sessionState.threadTokenUsageSnapshot?.threadId ===
    sessionState.lifecycle.sessionSnapshot?.activeThreadId
      ? formatCodexContextUsage(sessionState.threadTokenUsageSnapshot)
      : null;
  const startCodexTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildCodexTurnStarter({
        cachedTitle: input.sandboxStatus?.title,
        chat,
        ensureTransportConnected: input.ensureTransportConnected,
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath: input.selectedRepositoryPath,
      }),
    [
      chat,
      input.ensureTransportConnected,
      input.queryClient,
      input.sandboxInstanceId,
      input.sandboxStatus?.title,
      input.selectedRepositoryPath,
    ],
  );
  const startOpenCodeTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildOpenCodeTurnStarter({
        cachedTitle: input.sandboxStatus?.title,
        chat: openCodeSessionState.chat,
        modelSelection: {
          hasExplicitModelSelection: openCodeConfigControl.hasExplicitModelSelection,
          selectedModel: openCodeConfigControl.selectedModel,
        },
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath: input.selectedRepositoryPath,
      }),
    [
      input.queryClient,
      input.sandboxInstanceId,
      input.sandboxStatus?.title,
      input.selectedRepositoryPath,
      openCodeConfigControl.hasExplicitModelSelection,
      openCodeConfigControl.selectedModel,
      openCodeSessionState.chat,
      openCodeSessionState.chat.chatState.messageOrder.length,
    ],
  );
  const startPiTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildPiTurnStarter({
        chat: input.piSessionState.chat,
      }),
    [input.piSessionState.chat],
  );
  const steerPiTurn = useMemo<SessionTurnControl["steerTurn"]>(
    () =>
      buildPiTurnSteerer({
        chat: input.piSessionState.chat,
      }),
    [input.piSessionState.chat],
  );
  const queuePiTurn = useMemo<NonNullable<SessionTurnControl["queueTurn"]>>(
    () =>
      buildPiTurnQueuer({
        chat: input.piSessionState.chat,
      }),
    [input.piSessionState.chat],
  );
  const codexBootstrap = useMemo(() => {
    if (
      sessionState.threads.pendingThreadId === null &&
      !sessionState.threads.isStartingNewThread
    ) {
      return sessionState.bootstrap;
    }

    return {
      ...sessionState.bootstrap,
      phase: {
        status: "bootstrapping" as const,
      },
    };
  }, [
    sessionState.bootstrap,
    sessionState.threads.isStartingNewThread,
    sessionState.threads.pendingThreadId,
  ]);
  const codexRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () =>
      buildCodexConversationRuntime({
        activeConversationId: activeRuntimeConversationId,
        bootstrap: codexBootstrap,
        chat,
        configControl,
        contextUsage,
        serverRequests,
        sessionMessage,
        startTurn: startCodexTurn,
        compactThread: sessionState.threads.compactThread,
        goals: sessionState.goals,
      }),
    [
      activeRuntimeConversationId,
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
      sessionMessage.reportSessionErrorMessage,
      sessionMessage.sessionErrorMessage,
      codexBootstrap,
      sessionState.threads.compactThread,
      sessionState.goals,
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
  const piRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () =>
      buildPiConversationRuntime({
        bootstrap: piComposerBootstrap,
        chat: input.piSessionState.chat,
        configControl: piConfigControl,
        sessionMessage: input.piSessionState.sessionMessage,
        sessionSnapshot: input.piSessionState.lifecycle.sessionSnapshot,
        queueTurn: queuePiTurn,
        startTurn: startPiTurn,
        steerTurn: steerPiTurn,
      }),
    [
      input.piSessionState.chat.abortConversation,
      input.piSessionState.chat.canInterruptTurn,
      input.piSessionState.chat.canSteerTurn,
      input.piSessionState.chat.chatState,
      input.piSessionState.chat.isInterruptingTurn,
      input.piSessionState.chat.isStartingTurn,
      input.piSessionState.chat.isSteeringTurn,
      input.piSessionState.chat.followUpTurn,
      input.piSessionState.lifecycle.sessionSnapshot,
      input.piSessionState.sessionMessage.clearSessionErrorMessage,
      input.piSessionState.sessionMessage.reportSessionErrorMessage,
      input.piSessionState.sessionMessage.sessionErrorMessage,
      piComposerBootstrap,
      piConfigControl,
      queuePiTurn,
      startPiTurn,
      steerPiTurn,
    ],
  );
  const activeRuntime = input.isPiRuntime
    ? piRuntime
    : input.isOpenCodeRuntime
      ? openCodeRuntime
      : codexRuntime;
  const attachmentTargetId = activeRuntime.conversation.attachmentTargetId;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null &&
      input.sessionSnapshot !== null &&
      attachmentTargetId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: attachmentTargetId,
          }
        : null,
    ensureTransportConnected: input.ensureTransportConnected,
  });

  return {
    cliRuntimeDisplayName: activeRuntime.displayName,
    cliTerminalContentInset: activeRuntime.cliTerminalContentInset,
    conversationPane: {
      activeConversationId: activeRuntime.conversation.activeConversationId,
      attachmentTargetId: activeRuntime.conversation.attachmentTargetId,
      chatState: activeRuntime.conversation.chatState,
      ...(activeRuntime.conversation.dismissUserMessageAction === undefined
        ? {}
        : { dismissUserMessageAction: activeRuntime.conversation.dismissUserMessageAction }),
      composerStateInput: {
        ...activeRuntime.composerRuntimeInput,
        attachmentControl,
        repositoryStatus: input.repositoryStatus,
      },
      codexThreadNavigator:
        input.isOpenCodeRuntime || input.isPiRuntime
          ? null
          : {
              activeThreadCwd: sessionState.lifecycle.sessionSnapshot?.activeThreadCwd ?? null,
              activeThreadId: sessionState.lifecycle.sessionSnapshot?.activeThreadId ?? null,
              providerThreadId: sessionState.lifecycle.sessionSnapshot?.providerThreadId ?? null,
              availableThreads: sessionState.threads.availableThreads,
              hasMoreAvailableThreads: sessionState.threads.hasMoreAvailableThreads,
              originalThreadId: sessionState.threads.originalThreadId,
              pendingThreadId: sessionState.threads.pendingThreadId,
              isStartingNewThread: sessionState.threads.isStartingNewThread,
              refreshThreadList: sessionState.threads.refreshThreadList,
              resumeThread: sessionState.threads.resumeThread,
              startNewThread: sessionState.threads.startNewThread,
            },
      serverRequestsState: activeRuntime.serverRequestsState,
    },
  };
}
