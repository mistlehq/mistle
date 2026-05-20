import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import type { UseCodexSessionStateResult } from "../session-agents/codex/session-state/index.js";
import {
  resolveOpenCodePromptModelOverride,
  resolveOpenCodePromptVariantOverride,
  type UseOpenCodeSessionStateResult,
} from "../session-agents/opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "../session-agents/pi/session-state/index.js";
import type {
  RuntimeConversationNavigatorState,
  RuntimeConversationSummary,
} from "../session-agents/runtime-conversations/runtime-conversation-navigator-model.js";
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
  mergeWorkbenchComposerCapabilities,
  useSessionComposerAttachmentControl,
  useSessionComposerContextMentionControl,
  type SessionComposerSharedInput,
  type SessionComposerStateInput,
  type SessionTurnControl,
} from "./session-composer/index.js";
import { resolvePrimaryRepositoryTurnStartCwd } from "./session-primary-repository-policy.js";
import type { SessionTerminalContentInset } from "./session-terminal-surface.js";
import type { useSessionWorkbenchLifecycleState } from "./use-session-workbench-lifecycle-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

export type SessionConversationPaneState = SessionWorkbenchRuntimeAdapter["conversation"] & {
  composerStateInput: SessionComposerStateInput;
  serverRequestsState: SessionWorkbenchRuntimeAdapter["serverRequestsState"];
  runtimeConversationNavigator: RuntimeConversationNavigatorState | null;
};

type SessionWorkbenchConversationRuntimeState = {
  cliRuntimeDisplayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  conversationPane: SessionConversationPaneState;
};

function resolveCodexConversationTitle(
  thread: UseCodexSessionStateResult["threads"]["availableThreads"][number],
): string {
  if (thread.name !== null && thread.name.trim().length > 0) {
    return thread.name.trim();
  }

  const previewTitle = thread.preview
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (previewTitle !== undefined) {
    return previewTitle;
  }

  return "Untitled conversation";
}

function mapCodexThreadToRuntimeConversationSummary(
  thread: UseCodexSessionStateResult["threads"]["availableThreads"][number],
): RuntimeConversationSummary {
  return {
    id: thread.id,
    title: resolveCodexConversationTitle(thread),
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function mapOpenCodeSessionToRuntimeConversationSummary(
  session: UseOpenCodeSessionStateResult["sessions"]["availableSessions"][number],
): RuntimeConversationSummary {
  return {
    id: session.id,
    title: session.title,
    cwd: session.directory,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  };
}

function parseOptionalIsoDateTimeMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function mapPiConversationToRuntimeConversationSummary(
  conversation: UsePiSessionStateResult["conversations"]["availableConversations"][number],
): RuntimeConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title ?? "",
    cwd: conversation.cwd,
    createdAt: parseOptionalIsoDateTimeMs(conversation.createdAt),
    updatedAt: conversation.updatedAt,
  };
}

function mapRuntimeConversationCwdInput(input?: { cwd?: string | null }): {
  directory?: string | null;
} {
  return input?.cwd === undefined ? {} : { directory: input.cwd };
}

function mapRuntimeConversationStartOrResumeInput(input?: { cwd?: string }): {
  directory?: string;
} {
  return input?.cwd === undefined ? {} : { directory: input.cwd };
}

function buildCodexRuntimeConversationNavigatorState(input: {
  sessionState: UseCodexSessionStateResult;
}): RuntimeConversationNavigatorState {
  return {
    activeConversationCwd: input.sessionState.lifecycle.sessionSnapshot?.activeThreadCwd ?? null,
    activeConversationId: input.sessionState.lifecycle.sessionSnapshot?.activeThreadId ?? null,
    providerConversationId: input.sessionState.lifecycle.sessionSnapshot?.providerThreadId ?? null,
    availableConversations: input.sessionState.threads.availableThreads.map(
      mapCodexThreadToRuntimeConversationSummary,
    ),
    hasMoreAvailableConversations: input.sessionState.threads.hasMoreAvailableThreads,
    originalConversationId: input.sessionState.threads.originalThreadId,
    pendingConversationId: input.sessionState.threads.pendingThreadId,
    clearContextImplementationConversationId:
      input.sessionState.plans.clearContextImplementationThreadId,
    acknowledgeClearContextImplementationConversation:
      input.sessionState.plans.acknowledgeClearContextImplementationThread,
    isStartingNewConversation: input.sessionState.threads.isStartingNewThread,
    refreshConversationList: () => {
      input.sessionState.threads.refreshThreadList();
    },
    resumeConversation: input.sessionState.threads.resumeThread,
    startNewConversation: input.sessionState.threads.startNewThread,
  };
}

function buildOpenCodeRuntimeConversationNavigatorState(input: {
  openCodeSessionState: UseOpenCodeSessionStateResult;
}): RuntimeConversationNavigatorState {
  return {
    activeConversationCwd: input.openCodeSessionState.sessions.activeSessionDirectory,
    activeConversationId: input.openCodeSessionState.sessions.activeSessionId,
    providerConversationId:
      input.openCodeSessionState.lifecycle.sessionSnapshot?.providerSessionId ?? null,
    availableConversations: input.openCodeSessionState.sessions.availableSessions.map(
      mapOpenCodeSessionToRuntimeConversationSummary,
    ),
    hasMoreAvailableConversations: input.openCodeSessionState.sessions.hasMoreAvailableSessions,
    originalConversationId: input.openCodeSessionState.sessions.originalSessionId,
    pendingConversationId: input.openCodeSessionState.sessions.pendingSessionId,
    clearContextImplementationConversationId: null,
    acknowledgeClearContextImplementationConversation: () => {
      return;
    },
    isStartingNewConversation: input.openCodeSessionState.sessions.isStartingNewSession,
    refreshConversationList: async (refreshInput) => {
      await input.openCodeSessionState.sessions.refreshSessionList(
        mapRuntimeConversationCwdInput(refreshInput),
      );
    },
    resumeConversation: async (conversationId, resumeInput) =>
      await input.openCodeSessionState.sessions.resumeSession(
        conversationId,
        mapRuntimeConversationStartOrResumeInput(resumeInput),
      ),
    startNewConversation: async (startInput) =>
      await input.openCodeSessionState.sessions.startNewSession(
        mapRuntimeConversationStartOrResumeInput(startInput),
      ),
  };
}

function buildPiRuntimeConversationNavigatorState(input: {
  piSessionState: UsePiSessionStateResult;
}): RuntimeConversationNavigatorState {
  return {
    activeConversationCwd: input.piSessionState.conversations.activeConversationDirectory,
    activeConversationId: input.piSessionState.conversations.activeConversationId,
    providerConversationId:
      input.piSessionState.lifecycle.sessionSnapshot?.providerConversationId ?? null,
    availableConversations: input.piSessionState.conversations.availableConversations.map(
      mapPiConversationToRuntimeConversationSummary,
    ),
    hasMoreAvailableConversations: input.piSessionState.conversations.hasMoreAvailableConversations,
    originalConversationId: input.piSessionState.conversations.originalConversationId,
    pendingConversationId: input.piSessionState.conversations.pendingConversationId,
    clearContextImplementationConversationId: null,
    acknowledgeClearContextImplementationConversation: () => {
      return;
    },
    isStartingNewConversation: input.piSessionState.conversations.isStartingNewConversation,
    refreshConversationList: async (refreshInput) => {
      await input.piSessionState.conversations.refreshConversationList(
        mapRuntimeConversationCwdInput(refreshInput),
      );
    },
    resumeConversation: async (conversationId, resumeInput) =>
      await input.piSessionState.conversations.resumeConversation(
        conversationId,
        mapRuntimeConversationStartOrResumeInput(resumeInput),
      ),
    startNewConversation: async (startInput) =>
      await input.piSessionState.conversations.startNewConversation(
        mapRuntimeConversationStartOrResumeInput(startInput),
      ),
  };
}

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
          selectedReasoningEffort: openCodeConfigControl.selectedReasoningEffort,
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
      openCodeConfigControl.selectedReasoningEffort,
      openCodeSessionState.chat,
      openCodeSessionState.chat.chatState.messageOrder.length,
    ],
  );
  const executeOpenCodePromptCommand = useMemo(
    () =>
      async (commandInput: { text: string }): Promise<void> => {
        const selectedOpenCodeModel = resolveOpenCodePromptModelOverride(
          openCodeConfigControl.hasExplicitModelSelection,
          openCodeConfigControl.selectedModel,
        );
        const selectedOpenCodeVariant = resolveOpenCodePromptVariantOverride(
          openCodeConfigControl.selectedReasoningEffort,
        );

        await openCodeSessionState.commands.sendPromptCommand({
          ...(input.selectedRepositoryPath === null
            ? {}
            : { directory: input.selectedRepositoryPath }),
          ...(selectedOpenCodeModel === undefined ? {} : { model: selectedOpenCodeModel }),
          ...(selectedOpenCodeVariant === undefined ? {} : { variant: selectedOpenCodeVariant }),
          text: commandInput.text,
        });
      },
    [
      input.selectedRepositoryPath,
      openCodeConfigControl.hasExplicitModelSelection,
      openCodeConfigControl.selectedModel,
      openCodeConfigControl.selectedReasoningEffort,
      openCodeSessionState.commands.sendPromptCommand,
    ],
  );
  const startPiTurn = useMemo<SessionTurnControl["startTurn"]>(
    () =>
      buildPiTurnStarter({
        cachedTitle: input.sandboxStatus?.title,
        chat: input.piSessionState.chat,
        ensureTransportConnected: input.ensureTransportConnected,
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath: input.selectedRepositoryPath,
      }),
    [
      input.ensureTransportConnected,
      input.piSessionState.chat,
      input.queryClient,
      input.sandboxInstanceId,
      input.sandboxStatus?.title,
      input.selectedRepositoryPath,
    ],
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
        plans: sessionState.plans,
        reviews: sessionState.reviews,
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
      sessionState.plans,
      sessionState.reviews,
      startCodexTurn,
    ],
  );
  const openCodeRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () =>
      buildOpenCodeConversationRuntime({
        bootstrap: openCodeComposerBootstrap,
        chat: openCodeSessionState.chat,
        configControl: openCodeConfigControl,
        executePromptCommand: executeOpenCodePromptCommand,
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
      executeOpenCodePromptCommand,
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
  const runtimeConversationNavigator = input.isPiRuntime
    ? buildPiRuntimeConversationNavigatorState({
        piSessionState: input.piSessionState,
      })
    : input.isOpenCodeRuntime
      ? buildOpenCodeRuntimeConversationNavigatorState({
          openCodeSessionState,
        })
      : buildCodexRuntimeConversationNavigatorState({
          sessionState,
        });
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
  const activeContextMentionCwd =
    runtimeConversationNavigator.activeConversationCwd ??
    resolvePrimaryRepositoryTurnStartCwd(input.selectedRepositoryPath);
  const contextMentionControl = useSessionComposerContextMentionControl({
    cwd: activeContextMentionCwd,
    enabled: input.sandboxInstanceId !== null,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const composerBootstrap = useMemo(
    () => ({
      ...activeRuntime.composerRuntimeInput.bootstrap,
      composerCapabilities: mergeWorkbenchComposerCapabilities({
        composerCapabilities: activeRuntime.composerRuntimeInput.bootstrap.composerCapabilities,
        enableSandboxWorkspacePathContextMention: input.sandboxInstanceId !== null,
      }),
    }),
    [activeRuntime.composerRuntimeInput.bootstrap, input.sandboxInstanceId],
  );

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
        bootstrap: composerBootstrap,
        attachmentControl,
        contextMentionControl,
        repositoryStatus: input.repositoryStatus,
      },
      runtimeConversationNavigator,
      serverRequestsState: activeRuntime.serverRequestsState,
    },
  };
}
