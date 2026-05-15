import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import type { UseCodexSessionStateResult } from "../session-agents/codex/session-state/index.js";
import type { UseOpenCodeSessionStateResult } from "../session-agents/opencode/session-state/index.js";
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
  buildCodexTurnStarter,
  buildOpenCodeTurnStarter,
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
};

type SessionWorkbenchConversationRuntimeState = {
  cliRuntimeDisplayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  conversationPane: SessionConversationPaneState;
};

export function useSessionWorkbenchConversationRuntime(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  isOpenCodeRuntime: boolean;
  openCodeSessionState: UseOpenCodeSessionStateResult;
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
  const { configControl } = useCodexWorkbenchComposerState({
    sessionState,
  });
  const activeSessionThreadId = input.isOpenCodeRuntime
    ? null
    : (input.sessionSnapshot?.activeThreadId ?? null);
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
  const activeRuntime = input.isOpenCodeRuntime ? openCodeRuntime : codexRuntime;
  const activeConversationId = activeRuntime.conversation.activeConversationId;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null &&
      input.sessionSnapshot !== null &&
      activeConversationId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: activeConversationId,
          }
        : null,
    ensureTransportConnected: input.ensureTransportConnected,
  });

  return {
    cliRuntimeDisplayName: activeRuntime.displayName,
    cliTerminalContentInset: activeRuntime.cliTerminalContentInset,
    conversationPane: {
      activeConversationId: activeRuntime.conversation.activeConversationId,
      chatState: activeRuntime.conversation.chatState,
      ...(activeRuntime.conversation.dismissUserMessageAction === undefined
        ? {}
        : { dismissUserMessageAction: activeRuntime.conversation.dismissUserMessageAction }),
      composerStateInput: {
        ...activeRuntime.composerRuntimeInput,
        attachmentControl,
        repositoryStatus: input.repositoryStatus,
      },
      serverRequestsState: activeRuntime.serverRequestsState,
    },
  };
}
