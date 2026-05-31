import {
  archiveCodexThread,
  clearCodexThreadGoal,
  compactCodexThread,
  CodexComposerCommandIds,
  forkCodexThread,
  getCodexThreadGoal,
  rollbackCodexThread,
  resumeCodexThread,
  setCodexThreadGoal,
  startCodexReview,
  startCodexThread,
  unarchiveCodexThread,
  unsubscribeCodexThread,
  type CodexJsonRpcClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcServerRequest,
  type AgentStreamClient,
  type CodexThreadGoal,
  type CodexThreadGoalStatus,
  type CodexThreadSummary,
  type CodexReviewTarget,
  type CodexTurnCollaborationModeKind,
  type CodexTurnCollaborationModeSettings,
  type CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { ChatAttachment, ChatEntry, ChatPlanEntry } from "../../../chat/chat-types.js";
import type { ChatComposerCommandPanel } from "../../../chat/components/chat-composer.js";
import { hasComposerCommand } from "../../../pages/session-composer/session-composer-trigger-detection.js";
import {
  createInitialCodexApprovalRequestsState,
  reduceCodexApprovalRequestsState,
  type CodexApprovalRequestEntry,
} from "../approvals/codex-approval-requests-state.js";
import {
  editedGoalStatus,
  formatCodexGoalStatus,
  parseCodexGoalCommand,
  parseThreadGoalClearedNotification,
  parseThreadGoalUpdatedNotification,
  type CodexGoalPanel,
} from "./codex-goal-state.js";
import {
  codexReviewStartIsBlockedByTurnStatus,
  loadCodexReviewBranches,
  loadCodexReviewCommits,
  parseCodexReviewCommand,
  type CodexReviewCommitOption,
  type CodexReviewPanel,
} from "./codex-review-state.js";
import { parseThreadTokenUsageSnapshot } from "./codex-session-events.js";
import {
  type CodexThreadTokenUsageSnapshot,
  type ConnectedCodexSession,
  type StartSessionStep,
} from "./codex-session-types.js";
import { readCodexThreadState } from "./codex-thread-read-state.js";
import {
  useCodexSessionBootstrapData,
  useSessionBootstrap,
  resolveBootstrapConnectionContext,
  type BootstrapConnectionCandidate,
  type CodexSessionBootstrapDataState,
  type CodexSessionConfigState,
  type SessionBootstrapResult,
} from "./session-bootstrap/index.js";
import {
  StaleConnectionAttemptError,
  useCodexSessionConnection,
  type CodexSessionConnectionLifecycleState,
} from "./session-connection/index.js";
import {
  resolveCodexCliLaunchTarget,
  type CodexCliLaunchTarget,
} from "./session-thread-authority.js";
import { useCodexChatController, type CodexChatState } from "./use-codex-chat-controller.js";
import { useCodexThreadCollections } from "./use-codex-thread-collections.js";

export type { ConnectedCodexSession, StartSessionStep };

type CodexSessionThreadState = {
  availableThreads: readonly CodexThreadSummary[];
  hasMoreAvailableThreads: boolean;
  archivedThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  originalThreadId: string | null;
  pendingThreadId: string | null;
  isRefreshingThreads: boolean;
  isRefreshingLoadedThreads: boolean;
  isRefreshingArchivedThreads: boolean;
  isStartingNewThread: boolean;
  isResumingThread: boolean;
  isForkingThread: boolean;
  isArchivingThread: boolean;
  isUnarchivingThread: boolean;
  isUnsubscribingThread: boolean;
  isCompactingThread: boolean;
  isRollingBackThread: boolean;
  refreshThreadList: () => void;
  refreshLoadedThreadList: () => void;
  refreshArchivedThreadList: () => void;
  startNewThread: (input?: { cwd?: string }) => Promise<string>;
  resumeThread: (threadId: string) => Promise<string>;
  forkThread: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
  unarchiveThread: (threadId: string) => void;
  unsubscribeThread: (threadId: string) => void;
  compactThread: (threadId: string) => void;
  rollbackThread: (threadId: string, numTurns: number) => void;
  ensureCanSwitchPrimaryRepository: () => Promise<void>;
};

type ThreadNavigationMutationContext = {
  requestId: number;
};

type CodexPlanImplementationPrompt = {
  threadId: string;
  turnId: string;
  planEntryId: string;
  planMarkdown: string;
};

const CodexPlanImplementationMessage = "Implement the plan.";
const CodexPlanImplementationClearContextPrefix =
  "A previous agent produced the plan below to accomplish the user's task. " +
  "Implement the plan in a fresh context. Treat the plan as the source of " +
  "user intent, re-read files as needed, and carry the work through " +
  "implementation and verification.";

function findLatestProposedPlanEntry(entries: readonly ChatEntry[]): ChatPlanEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.kind === "plan" &&
      entry.text !== null &&
      entry.text.trim().length > 0 &&
      entry.steps === null
    ) {
      return entry;
    }
  }

  return null;
}

function hasUserEntryAfterPlan(input: {
  entries: readonly ChatEntry[];
  planEntryId: string;
}): boolean {
  const planIndex = input.entries.findIndex((entry) => entry.id === input.planEntryId);
  if (planIndex < 0) {
    return false;
  }

  return input.entries.slice(planIndex + 1).some((entry) => entry.kind === "user-message");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCompletedTurnId(notification: CodexJsonRpcNotification): string | null {
  if (notification.method !== "turn/completed" || !isRecord(notification.params)) {
    return null;
  }

  const turn = notification.params.turn;
  if (!isRecord(turn) || typeof turn.id !== "string" || turn.status !== "completed") {
    return null;
  }

  const turnError = turn.error;
  if (turnError !== undefined && turnError !== null) {
    return null;
  }

  return turn.id;
}

type CodexSessionChatState = {
  chatState: CodexChatState;
  isStartingTurn: boolean;
  isReloadingChat: boolean;
  isInterruptingTurn: boolean;
  isSteeringTurn: boolean;
  hasPendingFollowUp: boolean;
  canInterruptTurn: boolean;
  canSteerTurn: boolean;
  hydrateChatFromThread: () => Promise<void>;
  startTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
    cwd?: string;
    collaborationMode?: CodexTurnCollaborationModeKind | undefined;
    collaborationModeSettings?: CodexTurnCollaborationModeSettings | undefined;
  }) => Promise<void>;
  interruptTurn: () => void;
  dismissUserMessageAction: (actionId: string) => void;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
  }) => Promise<void>;
  reloadChat: () => void;
};

type CodexSessionServerRequestState = {
  pendingServerRequests: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  respondToServerRequest: (requestId: string | number, result: unknown) => void;
  resetServerRequests: () => void;
};

type CodexSessionMessageState = {
  clearSessionErrorMessage: () => void;
  reportSessionErrorMessage: (message: string) => void;
  sessionErrorMessage: string | null;
};

type CodexSessionGoalState = {
  activeGoal: CodexThreadGoal | null;
  activeGoalStatus: { label: string; title: string } | null;
  commandPanel: CodexGoalPanel | null;
  clearCommandPanel: () => void;
  confirmReplaceGoal: () => void;
  saveEditedGoal: (objective: string) => void;
  executeTypedComposerCommand: (input: { commandId: string; text: string }) => boolean;
};

type CodexSessionPlanState = {
  activeMode: "default" | "plan";
  clearContextImplementationThreadId: string | null;
  acknowledgeClearContextImplementationThread: (threadId: string) => void;
  commandPanel: ChatComposerCommandPanel | null;
  executeTypedComposerCommand: (input: { commandId: string; text: string }) => boolean;
  switchActiveThreadToDefault: () => void;
};

type CodexSessionReviewState = {
  commandPanel: ChatComposerCommandPanel | null;
  clearCommandPanel: () => void;
  executeTypedComposerCommand: (input: { commandId: string; text: string }) => boolean;
};

export type UseCodexSessionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  repositoryStatusRefreshEpoch: number;
  threadTokenUsageSnapshot: CodexThreadTokenUsageSnapshot | null;
  threadAuthority: {
    providerThreadId: string | null;
    resolveCliLaunchTarget: () => Promise<CodexCliLaunchTarget>;
    clearActiveThreadIdAfterCliLaunch: (launchTarget: CodexCliLaunchTarget) => void;
  };
  threads: CodexSessionThreadState;
  chat: CodexSessionChatState;
  bootstrap: SessionBootstrapResult;
  codexBootstrapData: CodexSessionBootstrapDataState;
  codexConfig: CodexSessionConfigState;
  serverRequests: CodexSessionServerRequestState;
  sessionMessage: CodexSessionMessageState;
  goals: CodexSessionGoalState;
  plans: CodexSessionPlanState;
  reviews: CodexSessionReviewState;
};

export function useCodexSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  sessionClientRef: RefObject<AgentStreamClient | null>;
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
  sessionEventUnsubscribersRef: RefObject<(() => void)[]>;
}): UseCodexSessionStateResult {
  const rpcClientRef = input.rpcClientRef;
  const sessionSnapshotRef = useRef<ConnectedCodexSession | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const threadNavigationMutationRequestRef = useRef(0);
  const reviewTargetLoadRequestRef = useRef(0);
  const [repositoryStatusRefreshEpoch, setRepositoryStatusRefreshEpoch] = useState(0);
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [threadTokenUsageSnapshot, setThreadTokenUsageSnapshot] =
    useState<CodexThreadTokenUsageSnapshot | null>(null);
  const [goalByThreadId, setGoalByThreadId] = useState<ReadonlyMap<string, CodexThreadGoal>>(
    () => new Map(),
  );
  const [loadedGoalThreadIds, setLoadedGoalThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [goalCommandPanel, setGoalCommandPanel] = useState<CodexGoalPanel | null>(null);
  const [reviewCommandPanel, setReviewCommandPanel] = useState<CodexReviewPanel | null>(null);
  const [planModeThreadIds, setPlanModeThreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [planImplementationPrompt, setPlanImplementationPrompt] =
    useState<CodexPlanImplementationPrompt | null>(null);
  const [liveCompletedTurnId, setLiveCompletedTurnId] = useState<string | null>(null);
  const [clearContextImplementationThreadId, setClearContextImplementationThreadId] = useState<
    string | null
  >(null);

  const recordLoadedGoal = useCallback((goal: CodexThreadGoal): void => {
    setGoalByThreadId((currentGoals) => {
      const nextGoals = new Map(currentGoals);
      nextGoals.set(goal.threadId, goal);
      return nextGoals;
    });
    setLoadedGoalThreadIds((currentThreadIds) => {
      const nextThreadIds = new Set(currentThreadIds);
      nextThreadIds.add(goal.threadId);
      return nextThreadIds;
    });
  }, []);

  const recordNoGoalForThread = useCallback((threadId: string): void => {
    setGoalByThreadId((currentGoals) => {
      const nextGoals = new Map(currentGoals);
      nextGoals.delete(threadId);
      return nextGoals;
    });
    setLoadedGoalThreadIds((currentThreadIds) => {
      const nextThreadIds = new Set(currentThreadIds);
      nextThreadIds.add(threadId);
      return nextThreadIds;
    });
  }, []);

  const [serverRequestsState, dispatchServerRequestsAction] = useReducer(
    reduceCodexApprovalRequestsState,
    undefined,
    createInitialCodexApprovalRequestsState,
  );
  const ensureCurrentGeneration = useCallback((generation: number): void => {
    if (connectionGenerationRef.current !== generation) {
      throw new StaleConnectionAttemptError();
    }
  }, []);

  const {
    availableThreads,
    hasMoreAvailableThreads,
    archivedThreads,
    loadedThreadIds,
    originalThreadId,
    refreshThreadList,
    refreshArchivedThreadList,
    refreshLoadedThreadList,
    refreshThreadCollections,
    recordStartedThreadAsOriginalAfterEmptyScan,
  } = useCodexThreadCollections({
    rpcClientRef: input.rpcClientRef,
    ensureCurrentGeneration,
  });

  const {
    chatState,
    resetChat,
    handleNotificationReceived,
    hydrateInitialThread,
    hydrateChatFromThread,
    isStartingTurn,
    isReloadingChat,
    isInterruptingTurn,
    isSteeringTurn,
    hasPendingFollowUp,
    canInterruptTurn,
    canSteerTurn,
    startTurn,
    reloadChat,
    interruptTurn,
    dismissUserMessageAction,
    steerTurn,
  } = useCodexChatController({
    rpcClientRef: input.rpcClientRef,
    threadIdRef,
    onTurnCwdCommitted: (turnCwd) => {
      updateActiveThread(turnCwd);
    },
    setSessionErrorMessage,
  });

  const bootstrapDataState = useCodexSessionBootstrapData({
    rpcClientRef: input.rpcClientRef,
    setLifecycleErrorMessage,
  });
  const {
    availableModels,
    modelCatalogStatus,
    configStatus,
    configJson,
    isLoadingModels,
    isReadingConfig,
    isWritingConfigValue,
    isBatchWritingConfig,
    listFeaturesAsync,
    listSkillsAsync,
    loadModelsAsync,
    readConfigAsync,
    writeConfigValue,
    batchWriteConfig,
  } = bootstrapDataState;

  const handleServerRequestNotification = useCallback((notification: CodexJsonRpcNotification) => {
    dispatchServerRequestsAction({
      type: "notification_received",
      notification,
    });
  }, []);

  const handleServerRequestReceived = useCallback((request: CodexJsonRpcServerRequest) => {
    dispatchServerRequestsAction({
      type: "server_request_received",
      request,
    });
  }, []);

  const handleSessionNotificationReceived = useCallback(
    (notification: CodexJsonRpcNotification): void => {
      const tokenUsageSnapshot = parseThreadTokenUsageSnapshot(notification);
      if (tokenUsageSnapshot !== null) {
        setThreadTokenUsageSnapshot(tokenUsageSnapshot);
      }

      const updatedGoal = parseThreadGoalUpdatedNotification(notification);
      if (updatedGoal !== null) {
        recordLoadedGoal(updatedGoal);
      }

      const clearedGoalThreadId = parseThreadGoalClearedNotification(notification);
      if (clearedGoalThreadId !== null) {
        recordNoGoalForThread(clearedGoalThreadId);
      }

      const completedTurnId = readCompletedTurnId(notification);
      if (completedTurnId !== null) {
        setLiveCompletedTurnId(completedTurnId);
      }

      handleNotificationReceived(notification);
    },
    [handleNotificationReceived, recordLoadedGoal, recordNoGoalForThread],
  );

  const { lifecycle, updateActiveThread } = useCodexSessionConnection({
    connectionGenerationRef,
    ensureCurrentGeneration,
    handleChatNotificationReceived: handleSessionNotificationReceived,
    onTurnCompleted: () => {
      setRepositoryStatusRefreshEpoch((currentEpoch) => currentEpoch + 1);
    },
    onServerRequestNotification: handleServerRequestNotification,
    onServerRequestReceived: handleServerRequestReceived,
    refreshThreadCollections,
    recordStartedThreadAsOriginalAfterEmptyScan,
    ensureTransportConnected: input.ensureTransportConnected,
    rpcClientRef: input.rpcClientRef,
    sessionClientRef: input.sessionClientRef,
    sessionEventUnsubscribersRef: input.sessionEventUnsubscribersRef,
    lifecycleErrorMessage,
    setLifecycleErrorMessage,
    threadIdRef,
  });
  const startThreadNavigationMutation = useCallback(
    (input: { pendingThreadId: string | null }): ThreadNavigationMutationContext => {
      const requestId = threadNavigationMutationRequestRef.current + 1;
      threadNavigationMutationRequestRef.current = requestId;
      setPendingThreadId(input.pendingThreadId);
      return { requestId };
    },
    [],
  );
  const isCurrentThreadNavigationMutation = useCallback(
    (context: ThreadNavigationMutationContext): boolean => {
      return threadNavigationMutationRequestRef.current === context.requestId;
    },
    [],
  );
  sessionSnapshotRef.current = lifecycle.sessionSnapshot;
  const { sessionSnapshot } = lifecycle;
  const bootstrapConnectionCandidate = useMemo<BootstrapConnectionCandidate | null>(() => {
    if (sessionSnapshot === null) {
      return null;
    }

    return {
      sandboxInstanceId: sessionSnapshot.sandboxInstanceId,
      connectedAtIso: sessionSnapshot.connectedAtIso,
      activeThreadId: sessionSnapshot.activeThreadId,
      activeThreadCwd: sessionSnapshot.activeThreadCwd,
    };
  }, [sessionSnapshot]);
  const bootstrapConnectionContext = useMemo(
    () =>
      resolveBootstrapConnectionContext({
        connectionCandidate: bootstrapConnectionCandidate,
      }),
    [bootstrapConnectionCandidate],
  );

  const bootstrap = useSessionBootstrap({
    bootstrapConnectionContext,
    hydrateInitialThread,
    listFeaturesAsync,
    listSkillsAsync,
    loadModelsAsync,
    readConfigAsync,
    rpcClientRef: input.rpcClientRef,
  });

  const codexGoalsEnabled = useMemo(
    () =>
      hasComposerCommand({
        composerCapabilities: bootstrap.composerCapabilities,
        commandId: CodexComposerCommandIds.GOAL,
      }),
    [bootstrap.composerCapabilities],
  );

  useEffect(() => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (activeThreadId === null || bootstrap.phase.status !== "ready" || !codexGoalsEnabled) {
      return;
    }

    const rpcClient = rpcClientRef.current;
    if (rpcClient === null) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await getCodexThreadGoal({
          rpcClient,
          threadId: activeThreadId,
        });
        if (cancelled) {
          return;
        }

        if (result.goal === null) {
          recordNoGoalForThread(activeThreadId);
        } else {
          recordLoadedGoal(result.goal);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSessionErrorMessage(error instanceof Error ? error.message : "Could not read goal.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrap.phase.status,
    codexGoalsEnabled,
    lifecycle.sessionSnapshot?.activeThreadId,
    recordLoadedGoal,
    recordNoGoalForThread,
    rpcClientRef,
  ]);

  const handleThreadMutationFailure = useCallback(
    (fallbackMessage: string, error: unknown): void => {
      setLifecycleErrorMessage(error instanceof Error ? error.message : fallbackMessage);
    },
    [],
  );

  const refreshThreadCollectionsWithErrorHandling = useCallback((): void => {
    void refreshThreadCollections().catch((error: unknown) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not refresh thread collections.",
      );
    });
  }, [refreshThreadCollections]);

  const refreshLoadedThreadListWithErrorHandling = useCallback((): void => {
    void refreshLoadedThreadList().catch((error: unknown) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not refresh loaded thread list.",
      );
    });
  }, [refreshLoadedThreadList]);

  const refreshThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshThreadList();
    },
    onError: (error) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not refresh thread list.",
      );
    },
  });

  const refreshArchivedThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshArchivedThreadList();
    },
    onError: (error) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not refresh archived thread list.",
      );
    },
  });

  const refreshLoadedThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshLoadedThreadList();
    },
    onError: (error) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not refresh loaded thread list.",
      );
    },
  });

  const startNewThreadMutation = useMutation({
    onMutate: (): ThreadNavigationMutationContext => {
      return startThreadNavigationMutation({ pendingThreadId: null });
    },
    mutationFn: async (input?: { cwd?: string }) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before starting a new thread.");
      }

      const threadStart = await startCodexThread({
        ...(input?.cwd === undefined ? {} : { cwd: input.cwd }),
        rpcClient,
        model: "gpt-5.3-codex",
      });
      return threadStart;
    },
    onSuccess: (threadStart, _input, context) => {
      if (context === undefined || !isCurrentThreadNavigationMutation(context)) {
        return;
      }

      updateActiveThread({
        threadId: threadStart.threadId,
        cwd: threadStart.cwd,
      });
      resetChat();
      setLifecycleErrorMessage(null);
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error, _input, context) => {
      if (context === undefined || !isCurrentThreadNavigationMutation(context)) {
        return;
      }

      handleThreadMutationFailure("Could not start a new thread.", error);
    },
  });

  const resumeThreadMutation = useMutation({
    onMutate: (threadId): ThreadNavigationMutationContext => {
      return startThreadNavigationMutation({ pendingThreadId: threadId });
    },
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before resuming a thread.");
      }

      return resumeCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: (result, _threadId, context) => {
      if (context === undefined || !isCurrentThreadNavigationMutation(context)) {
        return;
      }

      updateActiveThread({
        threadId: result.threadId,
        cwd: result.cwd,
      });
      resetChat();
      setLifecycleErrorMessage(null);
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error, _threadId, context) => {
      if (context === undefined || !isCurrentThreadNavigationMutation(context)) {
        return;
      }

      handleThreadMutationFailure("Could not resume thread.", error);
    },
    onSettled: (_result, _error, _threadId, context) => {
      if (context === undefined || !isCurrentThreadNavigationMutation(context)) {
        return;
      }

      setPendingThreadId(null);
    },
  });

  const respondToServerRequestMutation = useMutation({
    mutationFn: async (input: { requestId: string | number; result: unknown }) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before responding to server requests.");
      }

      dispatchServerRequestsAction({
        type: "server_request_response_started",
        requestId: input.requestId,
      });

      try {
        await rpcClient.respond(input.requestId, input.result);
      } catch (error) {
        dispatchServerRequestsAction({
          type: "server_request_response_failed",
          requestId: input.requestId,
          errorMessage:
            error instanceof Error ? error.message : "Could not send server request response.",
        });
        throw error;
      }
    },
    onError: (error) => {
      setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not respond to the pending server request.",
      );
    },
  });

  const forkThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before forking a thread.");
      }

      return forkCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: (result) => {
      updateActiveThread({
        threadId: result.threadId,
        cwd: result.cwd,
      });
      resetChat();
      void hydrateChatFromThread();
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not fork thread.", error);
    },
  });

  const archiveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before archiving a thread.");
      }

      return archiveCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: (_result, threadId) => {
      if (threadIdRef.current === threadId) {
        resetChat();
      }
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not archive thread.", error);
    },
  });

  const unarchiveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before unarchiving a thread.");
      }

      const unarchivedThread = await unarchiveCodexThread({
        rpcClient,
        threadId,
      });
      return await resumeCodexThread({
        rpcClient,
        threadId: unarchivedThread.threadId,
      });
    },
    onSuccess: (result) => {
      updateActiveThread({
        threadId: result.threadId,
        cwd: result.cwd,
      });
      resetChat();
      void hydrateChatFromThread();
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not unarchive thread.", error);
    },
  });

  const unsubscribeThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before unsubscribing a thread.");
      }

      return unsubscribeCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: () => {
      refreshLoadedThreadListWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not unsubscribe thread.", error);
    },
  });

  const compactThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before compacting a thread.");
      }

      return compactCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: () => {},
    onError: (error) => {
      handleThreadMutationFailure("Could not compact thread.", error);
    },
  });

  const rollbackThreadMutation = useMutation({
    mutationFn: async (input: { threadId: string; numTurns: number }) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before rolling back a thread.");
      }

      return rollbackCodexThread({
        rpcClient,
        threadId: input.threadId,
        numTurns: input.numTurns,
      });
    },
    onSuccess: (result) => {
      updateActiveThread({
        threadId: result.threadId,
      });
      resetChat();
      void hydrateChatFromThread();
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not roll back thread.", error);
    },
  });

  const { mutate: refreshThreadListMutate, isPending: isRefreshingThreads } =
    refreshThreadListMutation;
  const { mutate: refreshLoadedThreadListMutate, isPending: isRefreshingLoadedThreads } =
    refreshLoadedThreadListMutation;
  const { mutate: refreshArchivedThreadListMutate, isPending: isRefreshingArchivedThreads } =
    refreshArchivedThreadListMutation;
  const { mutateAsync: startNewThreadMutateAsync, isPending: isStartingNewThread } =
    startNewThreadMutation;
  const { mutateAsync: resumeThreadMutateAsync, isPending: isResumingThread } =
    resumeThreadMutation;
  const { mutate: forkThreadMutate, isPending: isForkingThread } = forkThreadMutation;
  const { mutate: archiveThreadMutate, isPending: isArchivingThread } = archiveThreadMutation;
  const { mutate: unarchiveThreadMutate, isPending: isUnarchivingThread } = unarchiveThreadMutation;
  const { mutate: unsubscribeThreadMutate, isPending: isUnsubscribingThread } =
    unsubscribeThreadMutation;
  const { mutate: compactThreadMutate, isPending: isCompactingThread } = compactThreadMutation;
  const { mutate: rollbackThreadMutate, isPending: isRollingBackThread } = rollbackThreadMutation;
  const { mutate: respondToServerRequestMutate, isPending: isRespondingToServerRequest } =
    respondToServerRequestMutation;

  const refreshAvailableThreads = useCallback(() => {
    refreshThreadListMutate();
  }, [refreshThreadListMutate]);

  const refreshLoadedThreads = useCallback(() => {
    refreshLoadedThreadListMutate();
  }, [refreshLoadedThreadListMutate]);

  const refreshArchivedThreads = useCallback(() => {
    refreshArchivedThreadListMutate();
  }, [refreshArchivedThreadListMutate]);

  const startNewThread = useCallback(
    async (input?: { cwd?: string }): Promise<string> => {
      const result = await startNewThreadMutateAsync(input);
      return result.threadId;
    },
    [startNewThreadMutateAsync],
  );

  const resumeThread = useCallback(
    async (threadId: string): Promise<string> => {
      const result = await resumeThreadMutateAsync(threadId);
      return result.threadId;
    },
    [resumeThreadMutateAsync],
  );

  const ensureCanSwitchPrimaryRepository = useCallback(async (): Promise<void> => {
    try {
      if (rpcClientRef.current === null) {
        throw new Error("Connect to a sandbox session before switching the primary repository.");
      }

      if (threadIdRef.current === null) {
        throw new Error("Choose a thread before switching the primary repository.");
      }
    } catch (error) {
      handleThreadMutationFailure("Could not switch the primary repository.", error);
      throw error;
    }
  }, [handleThreadMutationFailure, rpcClientRef, threadIdRef]);

  const forkThread = useCallback(
    (threadId: string) => {
      forkThreadMutate(threadId);
    },
    [forkThreadMutate],
  );

  const archiveThread = useCallback(
    (threadId: string) => {
      archiveThreadMutate(threadId);
    },
    [archiveThreadMutate],
  );

  const unarchiveThread = useCallback(
    (threadId: string) => {
      unarchiveThreadMutate(threadId);
    },
    [unarchiveThreadMutate],
  );

  const unsubscribeThread = useCallback(
    (threadId: string) => {
      unsubscribeThreadMutate(threadId);
    },
    [unsubscribeThreadMutate],
  );

  const compactThread = useCallback(
    (threadId: string) => {
      compactThreadMutate(threadId);
    },
    [compactThreadMutate],
  );

  const rollbackThread = useCallback(
    (threadId: string, numTurns: number) => {
      rollbackThreadMutate({
        threadId,
        numTurns,
      });
    },
    [rollbackThreadMutate],
  );

  const respondToServerRequest = useCallback(
    (requestId: string | number, result: unknown) => {
      respondToServerRequestMutate({
        requestId,
        result,
      });
    },
    [respondToServerRequestMutate],
  );

  const resetServerRequests = useCallback(() => {
    dispatchServerRequestsAction({
      type: "reset",
    });
  }, []);

  const activeGoal = useMemo(() => {
    if (!codexGoalsEnabled) {
      return null;
    }

    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    return activeThreadId === null ? null : (goalByThreadId.get(activeThreadId) ?? null);
  }, [codexGoalsEnabled, goalByThreadId, lifecycle.sessionSnapshot?.activeThreadId]);

  const activeGoalIsLoaded = useMemo(() => {
    if (!codexGoalsEnabled) {
      return true;
    }

    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    return activeThreadId === null || loadedGoalThreadIds.has(activeThreadId);
  }, [codexGoalsEnabled, lifecycle.sessionSnapshot?.activeThreadId, loadedGoalThreadIds]);

  const activeGoalStatus = useMemo(
    () => (activeGoal === null ? null : formatCodexGoalStatus(activeGoal)),
    [activeGoal],
  );

  const activePlanMode = useMemo<"default" | "plan">(() => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    return activeThreadId !== null && planModeThreadIds.has(activeThreadId) ? "plan" : "default";
  }, [lifecycle.sessionSnapshot?.activeThreadId, planModeThreadIds]);
  const activeCodexTurnIsRunning = codexReviewStartIsBlockedByTurnStatus(chatState.status);

  const cancelReviewTargetLoad = useCallback((): void => {
    reviewTargetLoadRequestRef.current += 1;
    setReviewCommandPanel(null);
  }, []);

  const switchThreadToPlanMode = useCallback((threadId: string): void => {
    setPlanModeThreadIds((currentThreadIds) => {
      const nextThreadIds = new Set(currentThreadIds);
      nextThreadIds.add(threadId);
      return nextThreadIds;
    });
  }, []);

  const switchThreadToDefaultMode = useCallback((threadId: string): void => {
    setPlanModeThreadIds((currentThreadIds) => {
      const nextThreadIds = new Set(currentThreadIds);
      nextThreadIds.delete(threadId);
      return nextThreadIds;
    });
    setPlanImplementationPrompt((currentPrompt) =>
      currentPrompt?.threadId === threadId ? null : currentPrompt,
    );
  }, []);

  const switchActiveThreadToPlanMode = useCallback((): void => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (activeThreadId === null) {
      setSessionErrorMessage("Choose a Codex thread before switching to Plan mode.");
      return;
    }

    switchThreadToPlanMode(activeThreadId);
  }, [lifecycle.sessionSnapshot?.activeThreadId, switchThreadToPlanMode]);

  const switchActiveThreadToDefaultMode = useCallback((): void => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (activeThreadId === null) {
      setSessionErrorMessage("Choose a Codex thread before switching to Default mode.");
      return;
    }

    switchThreadToDefaultMode(activeThreadId);
  }, [lifecycle.sessionSnapshot?.activeThreadId, switchThreadToDefaultMode]);

  useEffect(() => {
    if (liveCompletedTurnId === null || activePlanMode !== "plan" || hasPendingFollowUp) {
      return;
    }

    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (activeThreadId === null) {
      return;
    }

    const proposedPlan = findLatestProposedPlanEntry(chatState.entries);
    if (
      proposedPlan === null ||
      proposedPlan.turnId !== liveCompletedTurnId ||
      proposedPlan.text === null ||
      hasUserEntryAfterPlan({ entries: chatState.entries, planEntryId: proposedPlan.id })
    ) {
      return;
    }

    setPlanImplementationPrompt({
      threadId: activeThreadId,
      turnId: proposedPlan.turnId,
      planEntryId: proposedPlan.id,
      planMarkdown: proposedPlan.text,
    });
    setLiveCompletedTurnId(null);
  }, [
    activePlanMode,
    chatState.entries,
    hasPendingFollowUp,
    lifecycle.sessionSnapshot?.activeThreadId,
    liveCompletedTurnId,
  ]);

  useEffect(() => {
    if (goalCommandPanel === null) {
      return;
    }

    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    const panelThreadId =
      goalCommandPanel.kind === "edit" ? goalCommandPanel.goal.threadId : goalCommandPanel.threadId;
    if (panelThreadId !== activeThreadId) {
      setGoalCommandPanel(null);
    }
  }, [goalCommandPanel, lifecycle.sessionSnapshot?.activeThreadId]);

  useEffect(() => {
    cancelReviewTargetLoad();
  }, [cancelReviewTargetLoad, lifecycle.sessionSnapshot?.activeThreadId]);

  useEffect(() => {
    if (activeCodexTurnIsRunning) {
      cancelReviewTargetLoad();
    }
  }, [activeCodexTurnIsRunning, cancelReviewTargetLoad]);

  useEffect(() => {
    if (planImplementationPrompt === null) {
      return;
    }

    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (
      planImplementationPrompt.threadId !== activeThreadId ||
      hasUserEntryAfterPlan({
        entries: chatState.entries,
        planEntryId: planImplementationPrompt.planEntryId,
      })
    ) {
      setPlanImplementationPrompt(null);
    }
  }, [chatState.entries, lifecycle.sessionSnapshot?.activeThreadId, planImplementationPrompt]);

  const implementPlanInCurrentThread = useCallback((): void => {
    const prompt = planImplementationPrompt;
    if (prompt === null) {
      return;
    }

    switchThreadToDefaultMode(prompt.threadId);
    setPlanImplementationPrompt(null);
    void startTurn({
      submittedPrompt: CodexPlanImplementationMessage,
      transcriptPrompt: CodexPlanImplementationMessage,
      collaborationMode: "default",
    }).catch((error: unknown) => {
      setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not submit plan implementation turn.",
      );
    });
  }, [planImplementationPrompt, startTurn, switchThreadToDefaultMode]);

  const clearContextAndImplementPlan = useCallback((): void => {
    const prompt = planImplementationPrompt;
    const activeThreadCwd = lifecycle.sessionSnapshot?.activeThreadCwd ?? null;
    const rpcClient = rpcClientRef.current;
    if (prompt === null) {
      return;
    }

    if (activeThreadCwd === null) {
      setSessionErrorMessage("The active Codex thread does not have a working directory.");
      return;
    }

    if (rpcClient === null) {
      setSessionErrorMessage("Connect to a sandbox session before starting a fresh Codex thread.");
      return;
    }

    setPlanImplementationPrompt(null);
    void (async (): Promise<void> => {
      try {
        const startedThread = await startCodexThread({
          rpcClient,
          cwd: activeThreadCwd,
          model: "gpt-5.3-codex",
          sessionStartSource: "clear",
        });
        setClearContextImplementationThreadId(startedThread.threadId);
        switchThreadToDefaultMode(prompt.threadId);
        updateActiveThread({
          threadId: startedThread.threadId,
          cwd: startedThread.cwd,
        });
        resetChat();
        refreshThreadCollectionsWithErrorHandling();

        const submittedPrompt = `${CodexPlanImplementationClearContextPrefix}\n\n${prompt.planMarkdown}`;
        await startTurn({
          submittedPrompt,
          transcriptPrompt: submittedPrompt,
          collaborationMode: "default",
        });
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not start fresh implementation thread.",
        );
      }
    })();
  }, [
    lifecycle.sessionSnapshot?.activeThreadCwd,
    planImplementationPrompt,
    refreshThreadCollectionsWithErrorHandling,
    resetChat,
    rpcClientRef,
    startTurn,
    switchThreadToDefaultMode,
    updateActiveThread,
  ]);

  const stayInPlanMode = useCallback((): void => {
    setPlanImplementationPrompt(null);
  }, []);

  const planCommandPanel = useMemo<ChatComposerCommandPanel | null>(() => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (
      planImplementationPrompt === null ||
      activeThreadId === null ||
      planImplementationPrompt.threadId !== activeThreadId ||
      activePlanMode !== "plan"
    ) {
      return null;
    }

    return {
      kind: "choice",
      title: "Implement this plan?",
      suppressWhenQueuedPrompts: true,
      choices: [
        {
          label: "Clear context and implement",
          onSelect: clearContextAndImplementPlan,
          variant: "secondary",
        },
        {
          label: "Dismiss",
          onSelect: stayInPlanMode,
          variant: "ghost",
        },
        {
          label: "Implement",
          onSelect: implementPlanInCurrentThread,
          variant: "default",
        },
      ],
    };
  }, [
    clearContextAndImplementPlan,
    activePlanMode,
    implementPlanInCurrentThread,
    lifecycle.sessionSnapshot?.activeThreadId,
    planImplementationPrompt,
    stayInPlanMode,
  ]);

  const startReviewForActiveThread = useCallback(
    (target: CodexReviewTarget): boolean => {
      const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
      const rpcClient = rpcClientRef.current;
      if (activeThreadId === null) {
        setSessionErrorMessage("Choose a Codex thread before starting a review.");
        return false;
      }
      if (rpcClient === null) {
        setSessionErrorMessage("Connect to a sandbox session before starting a review.");
        return false;
      }
      if (activeCodexTurnIsRunning) {
        setSessionErrorMessage("/review is disabled while a task is in progress.");
        cancelReviewTargetLoad();
        return false;
      }

      cancelReviewTargetLoad();
      void startCodexReview({
        rpcClient,
        threadId: activeThreadId,
        target,
      }).catch((error: unknown) => {
        setSessionErrorMessage(error instanceof Error ? error.message : "Could not start review.");
      });
      return true;
    },
    [
      activeCodexTurnIsRunning,
      cancelReviewTargetLoad,
      lifecycle.sessionSnapshot?.activeThreadId,
      rpcClientRef,
    ],
  );

  const ensureReviewTransport = useCallback(async (): Promise<{
    repositoryPath: string;
    threadId: string;
    transport: SandboxSessionTransport;
  }> => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    const sandboxInstanceId = lifecycle.sessionSnapshot?.sandboxInstanceId ?? null;
    const repositoryPath = lifecycle.sessionSnapshot?.activeThreadCwd ?? null;
    if (activeThreadId === null) {
      throw new Error("Choose a Codex thread before loading review targets.");
    }
    if (sandboxInstanceId === null) {
      throw new Error("Connect to a sandbox session before loading review targets.");
    }
    if (repositoryPath === null) {
      throw new Error("The active Codex thread does not have a working directory.");
    }

    const { transport } = await input.ensureTransportConnected({
      sandboxInstanceId,
    });
    return { repositoryPath, threadId: activeThreadId, transport };
  }, [
    input.ensureTransportConnected,
    lifecycle.sessionSnapshot?.activeThreadCwd,
    lifecycle.sessionSnapshot?.activeThreadId,
    lifecycle.sessionSnapshot?.sandboxInstanceId,
  ]);

  const reviewTargetLoadIsCurrent = useCallback(
    (input: { repositoryPath: string; requestId: number; threadId: string }): boolean => {
      const snapshot = sessionSnapshotRef.current;
      return (
        reviewTargetLoadRequestRef.current === input.requestId &&
        snapshot?.activeThreadId === input.threadId &&
        snapshot.activeThreadCwd === input.repositoryPath
      );
    },
    [],
  );

  const reviewRequestIdIsCurrent = useCallback((requestId: number): boolean => {
    return reviewTargetLoadRequestRef.current === requestId;
  }, []);

  const loadReviewBranchPicker = useCallback(
    async (requestId: number): Promise<void> => {
      let loadTarget: { repositoryPath: string; threadId: string } | null = null;
      try {
        const { repositoryPath, threadId, transport } = await ensureReviewTransport();
        loadTarget = { repositoryPath, threadId };
        const branches = await loadCodexReviewBranches({
          cwd: repositoryPath,
          transport,
        });
        if (!reviewTargetLoadIsCurrent({ repositoryPath, requestId, threadId })) {
          return;
        }
        setReviewCommandPanel({
          kind: "branchPicker",
          branches,
        });
      } catch (error) {
        if (
          loadTarget === null
            ? !reviewRequestIdIsCurrent(requestId)
            : !reviewTargetLoadIsCurrent({ ...loadTarget, requestId })
        ) {
          return;
        }
        setReviewCommandPanel(null);
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not load review branches.",
        );
      }
    },
    [ensureReviewTransport, reviewRequestIdIsCurrent, reviewTargetLoadIsCurrent],
  );

  const openReviewBranchPicker = useCallback((): void => {
    const requestId = reviewTargetLoadRequestRef.current + 1;
    reviewTargetLoadRequestRef.current = requestId;
    setReviewCommandPanel({
      kind: "branchPicker",
      branches: null,
    });
    void loadReviewBranchPicker(requestId);
  }, [loadReviewBranchPicker]);

  const loadReviewCommitPicker = useCallback(
    async (requestId: number): Promise<void> => {
      let loadTarget: { repositoryPath: string; threadId: string } | null = null;
      try {
        const { repositoryPath, threadId, transport } = await ensureReviewTransport();
        loadTarget = { repositoryPath, threadId };
        const commits = await loadCodexReviewCommits({
          cwd: repositoryPath,
          transport,
        });
        if (!reviewTargetLoadIsCurrent({ repositoryPath, requestId, threadId })) {
          return;
        }
        setReviewCommandPanel({
          kind: "commitPicker",
          commits,
        });
      } catch (error) {
        if (
          loadTarget === null
            ? !reviewRequestIdIsCurrent(requestId)
            : !reviewTargetLoadIsCurrent({ ...loadTarget, requestId })
        ) {
          return;
        }
        setReviewCommandPanel(null);
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not load review commits.",
        );
      }
    },
    [ensureReviewTransport, reviewRequestIdIsCurrent, reviewTargetLoadIsCurrent],
  );

  const openReviewCommitPicker = useCallback((): void => {
    const requestId = reviewTargetLoadRequestRef.current + 1;
    reviewTargetLoadRequestRef.current = requestId;
    setReviewCommandPanel({
      kind: "commitPicker",
      commits: null,
    });
    void loadReviewCommitPicker(requestId);
  }, [loadReviewCommitPicker]);

  const runReviewCommand = useCallback(
    (commandText: string): boolean => {
      const parsedCommand = parseCodexReviewCommand(commandText);
      if (parsedCommand.status === "notReviewCommand") {
        setSessionErrorMessage(`Unsupported Codex runtime command '${commandText}'.`);
        return false;
      }

      if (parsedCommand.command.kind === "showTargetPicker") {
        if (activeCodexTurnIsRunning) {
          setSessionErrorMessage("/review is disabled while a task is in progress.");
          cancelReviewTargetLoad();
          return false;
        }
        cancelReviewTargetLoad();
        setReviewCommandPanel({ kind: "targetPicker" });
        return true;
      }

      return startReviewForActiveThread({
        type: "custom",
        instructions: parsedCommand.command.instructions,
      });
    },
    [activeCodexTurnIsRunning, cancelReviewTargetLoad, startReviewForActiveThread],
  );

  const reviewCommandPanelView = useMemo<ChatComposerCommandPanel | null>(() => {
    if (reviewCommandPanel === null) {
      return null;
    }

    if (reviewCommandPanel.kind === "targetPicker") {
      return {
        kind: "picker",
        title: "Review target",
        searchPlaceholder: "Search",
        emptyLabel: "No review targets found",
        onCancel: () => {
          cancelReviewTargetLoad();
        },
        options: [
          {
            label: "Review against a base branch (PR Style)",
            onSelect: openReviewBranchPicker,
          },
          {
            label: "Review uncommitted changes",
            onSelect: () => {
              startReviewForActiveThread({ type: "uncommittedChanges" });
            },
          },
          {
            label: "Review a commit",
            onSelect: openReviewCommitPicker,
          },
        ],
      };
    }

    if (reviewCommandPanel.kind === "branchPicker") {
      const branches = reviewCommandPanel.branches ?? [];
      return {
        kind: "picker",
        title:
          reviewCommandPanel.branches === null
            ? "Loading branches..."
            : branches.length === 0
              ? "No branches found"
              : "Review against a base branch",
        searchPlaceholder: "Search branches",
        emptyLabel:
          reviewCommandPanel.branches === null ? "Loading branches..." : "No matching branches",
        onCancel: () => {
          cancelReviewTargetLoad();
          setReviewCommandPanel({ kind: "targetPicker" });
        },
        options: branches.map((branch) => ({
          label: `Review against ${branch}`,
          onSelect: () => {
            startReviewForActiveThread({
              type: "baseBranch",
              branch,
            });
          },
        })),
      };
    }

    const commits = reviewCommandPanel.commits ?? [];
    return {
      kind: "picker",
      title:
        reviewCommandPanel.commits === null
          ? "Loading commits..."
          : commits.length === 0
            ? "No commits found"
            : "Review commit",
      searchPlaceholder: "Search commits",
      emptyLabel:
        reviewCommandPanel.commits === null ? "Loading commits..." : "No matching commits",
      onCancel: () => {
        cancelReviewTargetLoad();
        setReviewCommandPanel({ kind: "targetPicker" });
      },
      options: commits.map((commit: CodexReviewCommitOption) => ({
        label: `${commit.sha.slice(0, 7)} ${commit.title}`,
        onSelect: () => {
          startReviewForActiveThread({
            type: "commit",
            sha: commit.sha,
            title: commit.title,
          });
        },
      })),
    };
  }, [
    cancelReviewTargetLoad,
    openReviewBranchPicker,
    openReviewCommitPicker,
    reviewCommandPanel,
    startReviewForActiveThread,
  ]);

  const setGoalForThread = useCallback(
    async (input: {
      threadId: string;
      objective?: string;
      status?: CodexThreadGoalStatus;
      tokenBudget?: number | null;
    }): Promise<CodexThreadGoal> => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("The session must start before you can change a goal.");
      }

      const result = await setCodexThreadGoal({
        rpcClient,
        threadId: input.threadId,
        ...(input.objective === undefined ? {} : { objective: input.objective }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
      });
      recordLoadedGoal(result.goal);
      return result.goal;
    },
    [recordLoadedGoal, rpcClientRef],
  );

  const setGoalForActiveThread = useCallback(
    async (input: {
      objective?: string;
      status?: CodexThreadGoalStatus;
      tokenBudget?: number | null;
    }): Promise<CodexThreadGoal> => {
      const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
      if (activeThreadId === null) {
        throw new Error("The session must start before you can change a goal.");
      }

      return await setGoalForThread({
        threadId: activeThreadId,
        ...input,
      });
    },
    [lifecycle.sessionSnapshot?.activeThreadId, setGoalForThread],
  );

  const clearGoalForThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("The session must start before you can clear a goal.");
      }

      const result = await clearCodexThreadGoal({
        rpcClient,
        threadId,
      });
      recordNoGoalForThread(threadId);
      return result.cleared;
    },
    [recordNoGoalForThread, rpcClientRef],
  );

  const clearGoalForActiveThread = useCallback(async (): Promise<boolean> => {
    const activeThreadId = lifecycle.sessionSnapshot?.activeThreadId ?? null;
    if (activeThreadId === null) {
      throw new Error("The session must start before you can clear a goal.");
    }

    return await clearGoalForThread(activeThreadId);
  }, [clearGoalForThread, lifecycle.sessionSnapshot?.activeThreadId]);

  const runGoalCommand = useCallback(
    (commandText: string): boolean => {
      const parsedCommand = parseCodexGoalCommand(commandText);
      if (parsedCommand.status === "notGoalCommand") {
        setSessionErrorMessage(`Unsupported Codex runtime command '${commandText}'.`);
        return false;
      }
      if (parsedCommand.status === "invalid") {
        setSessionErrorMessage(parsedCommand.message);
        return false;
      }

      const command = parsedCommand.command;
      if (command.kind === "show") {
        if (!activeGoalIsLoaded) {
          setSessionErrorMessage("Goal state is still loading.");
          return false;
        }

        setSessionErrorMessage(
          activeGoal === null
            ? "No goal is currently set. Usage: /goal <objective>"
            : formatCodexGoalStatus(activeGoal).title,
        );
        return true;
      }

      if (command.kind === "edit") {
        if (!activeGoalIsLoaded) {
          setSessionErrorMessage("Goal state is still loading.");
          return false;
        }

        if (activeGoal === null) {
          setSessionErrorMessage("No goal is currently set.");
          return false;
        }
        setGoalCommandPanel({
          kind: "edit",
          goal: activeGoal,
        });
        return true;
      }

      if (command.kind === "setObjective") {
        if (!activeGoalIsLoaded) {
          setSessionErrorMessage("Goal state is still loading.");
          return false;
        }

        if (activeGoal !== null) {
          setGoalCommandPanel({
            kind: "replaceConfirmation",
            threadId: activeGoal.threadId,
            objective: command.objective,
          });
          return true;
        }

        void setGoalForActiveThread({
          objective: command.objective,
          status: "active",
        }).catch((error: unknown) => {
          setSessionErrorMessage(error instanceof Error ? error.message : "Could not set goal.");
        });
        return true;
      }

      if (command.kind === "clear") {
        void clearGoalForActiveThread()
          .then((cleared) => {
            setSessionErrorMessage(cleared ? "Goal cleared." : "No goal to clear.");
          })
          .catch((error: unknown) => {
            setSessionErrorMessage(
              error instanceof Error ? error.message : "Could not clear goal.",
            );
          });
        return true;
      }

      if (!activeGoalIsLoaded) {
        setSessionErrorMessage("Goal state is still loading.");
        return false;
      }

      if (activeGoal === null) {
        setSessionErrorMessage("No goal is currently set.");
        return false;
      }

      void setGoalForActiveThread({
        status: command.status,
      }).catch((error: unknown) => {
        setSessionErrorMessage(error instanceof Error ? error.message : "Could not update goal.");
      });
      return true;
    },
    [activeGoal, activeGoalIsLoaded, clearGoalForActiveThread, setGoalForActiveThread],
  );

  const executeGoalTypedComposerCommand = useCallback(
    (inputValue: { commandId: string; text: string }): boolean => {
      if (inputValue.commandId !== CodexComposerCommandIds.GOAL) {
        setSessionErrorMessage(`Unsupported Codex runtime command '${inputValue.commandId}'.`);
        return false;
      }

      return runGoalCommand(inputValue.text);
    },
    [runGoalCommand],
  );

  const executeReviewTypedComposerCommand = useCallback(
    (inputValue: { commandId: string; text: string }): boolean => {
      if (inputValue.commandId !== CodexComposerCommandIds.REVIEW) {
        setSessionErrorMessage(`Unsupported Codex runtime command '${inputValue.commandId}'.`);
        return false;
      }

      return runReviewCommand(inputValue.text);
    },
    [runReviewCommand],
  );

  const clearGoalCommandPanel = useCallback((): void => {
    setGoalCommandPanel(null);
  }, []);

  const confirmReplaceGoal = useCallback((): void => {
    if (goalCommandPanel?.kind !== "replaceConfirmation") {
      return;
    }

    const nextObjective = goalCommandPanel.objective;
    const threadId = goalCommandPanel.threadId;
    setGoalCommandPanel(null);
    void (async () => {
      try {
        // Codex TUI replacement clears before setting so accounting and budget
        // state reset instead of editing the existing goal in place.
        await clearGoalForThread(threadId);
        await setGoalForThread({
          threadId,
          objective: nextObjective,
          status: "active",
        });
      } catch (error) {
        setSessionErrorMessage(error instanceof Error ? error.message : "Could not replace goal.");
      }
    })();
  }, [clearGoalForThread, goalCommandPanel, setGoalForThread]);

  const saveEditedGoal = useCallback(
    (objective: string): void => {
      if (goalCommandPanel?.kind !== "edit") {
        return;
      }

      const trimmedObjective = objective.trim();
      if (trimmedObjective.length === 0) {
        setSessionErrorMessage("Goal objective must not be empty.");
        return;
      }

      const goal = goalCommandPanel.goal;
      setGoalCommandPanel(null);
      void setGoalForThread({
        threadId: goal.threadId,
        objective: trimmedObjective,
        status: editedGoalStatus(goal.status),
        tokenBudget: goal.tokenBudget,
      }).catch((error: unknown) => {
        setSessionErrorMessage(error instanceof Error ? error.message : "Could not edit goal.");
      });
    },
    [goalCommandPanel, setGoalForThread],
  );

  const resolveCliLaunchTarget = useCallback(async (): Promise<CodexCliLaunchTarget> => {
    const activeThreadId = threadIdRef.current;
    const providerThreadId = lifecycle.sessionSnapshot?.providerThreadId ?? null;
    if (activeThreadId === null) {
      return {
        type: "start_new",
        shouldClearActiveThreadId: false,
      };
    }

    const rpcClient = rpcClientRef.current;
    if (rpcClient === null) {
      throw new Error("Connect to a sandbox session before starting Codex TUI.");
    }

    const thread = await readCodexThreadState({
      rpcClient,
      threadId: activeThreadId,
    });
    const launchTarget = resolveCodexCliLaunchTarget({
      activeThreadId,
      turnCount: thread.turns.length,
    });

    if (providerThreadId !== null && launchTarget.type === "start_new") {
      throw new Error(
        `The linked provider conversation '${providerThreadId}' is not resumable for Codex TUI.`,
      );
    }

    return launchTarget;
  }, [lifecycle.sessionSnapshot?.providerThreadId]);

  const clearActiveThreadIdAfterCliLaunch = useCallback(
    (launchTarget: CodexCliLaunchTarget): void => {
      if (lifecycle.sessionSnapshot?.providerThreadId !== null) {
        return;
      }

      if (launchTarget.type !== "start_new" || !launchTarget.shouldClearActiveThreadId) {
        return;
      }

      // Non-provider thread authority is intentionally ephemeral across CLI handoff.
      // Returning from CLI reconnects local sessions using the
      // "most_recently_updated" thread policy instead of trying to preserve the
      // pre-CLI active thread id.
      updateActiveThread({
        threadId: null,
      });
    },
    [lifecycle.sessionSnapshot?.providerThreadId, updateActiveThread],
  );

  const threads = useMemo<CodexSessionThreadState>(() => {
    return {
      availableThreads,
      hasMoreAvailableThreads,
      archivedThreads,
      loadedThreadIds,
      originalThreadId,
      pendingThreadId,
      isRefreshingThreads,
      isRefreshingLoadedThreads,
      isRefreshingArchivedThreads,
      isStartingNewThread,
      isResumingThread,
      isForkingThread,
      isArchivingThread,
      isUnarchivingThread,
      isUnsubscribingThread,
      isCompactingThread,
      isRollingBackThread,
      refreshThreadList: refreshAvailableThreads,
      refreshLoadedThreadList: refreshLoadedThreads,
      refreshArchivedThreadList: refreshArchivedThreads,
      startNewThread,
      resumeThread,
      forkThread,
      archiveThread,
      unarchiveThread,
      unsubscribeThread,
      compactThread,
      rollbackThread,
      ensureCanSwitchPrimaryRepository,
    };
  }, [
    archiveThread,
    archivedThreads,
    availableThreads,
    hasMoreAvailableThreads,
    compactThread,
    forkThread,
    isArchivingThread,
    isCompactingThread,
    isForkingThread,
    isRefreshingArchivedThreads,
    isRefreshingLoadedThreads,
    isRefreshingThreads,
    isResumingThread,
    isRollingBackThread,
    isStartingNewThread,
    isUnarchivingThread,
    isUnsubscribingThread,
    loadedThreadIds,
    originalThreadId,
    pendingThreadId,
    refreshAvailableThreads,
    refreshLoadedThreads,
    refreshArchivedThreads,
    resumeThread,
    rollbackThread,
    startNewThread,
    ensureCanSwitchPrimaryRepository,
    unarchiveThread,
    unsubscribeThread,
  ]);

  const threadAuthority = useMemo(() => {
    return {
      providerThreadId: lifecycle.sessionSnapshot?.providerThreadId ?? null,
      resolveCliLaunchTarget,
      clearActiveThreadIdAfterCliLaunch,
    };
  }, [
    clearActiveThreadIdAfterCliLaunch,
    lifecycle.sessionSnapshot?.providerThreadId,
    resolveCliLaunchTarget,
  ]);

  const chat = useMemo<CodexSessionChatState>(() => {
    return {
      chatState,
      isStartingTurn,
      isReloadingChat,
      isInterruptingTurn,
      isSteeringTurn,
      hasPendingFollowUp,
      canInterruptTurn,
      canSteerTurn,
      hydrateChatFromThread,
      startTurn,
      interruptTurn,
      dismissUserMessageAction,
      steerTurn,
      reloadChat,
    };
  }, [
    canInterruptTurn,
    canSteerTurn,
    hasPendingFollowUp,
    hydrateChatFromThread,
    dismissUserMessageAction,
    interruptTurn,
    isInterruptingTurn,
    isReloadingChat,
    isStartingTurn,
    isSteeringTurn,
    reloadChat,
    startTurn,
    steerTurn,
    chatState,
  ]);

  const codexBootstrapData = useMemo<CodexSessionBootstrapDataState>(() => {
    return {
      availableModels,
      modelCatalogStatus,
      configJson,
      configStatus,
      isLoadingModels,
      isReadingConfig,
      listFeaturesAsync,
      listSkillsAsync,
      loadModelsAsync,
      readConfigAsync,
    };
  }, [
    availableModels,
    configJson,
    configStatus,
    isLoadingModels,
    isReadingConfig,
    listFeaturesAsync,
    listSkillsAsync,
    loadModelsAsync,
    readConfigAsync,
    modelCatalogStatus,
  ]);

  const codexConfig = useMemo<CodexSessionConfigState>(() => {
    return {
      isWritingConfigValue,
      isBatchWritingConfig,
      writeConfigValue,
      batchWriteConfig,
    };
  }, [batchWriteConfig, isBatchWritingConfig, isWritingConfigValue, writeConfigValue]);

  const serverRequests = useMemo<CodexSessionServerRequestState>(() => {
    return {
      pendingServerRequests: serverRequestsState.entries,
      isRespondingToServerRequest,
      respondToServerRequest,
      resetServerRequests,
    };
  }, [
    isRespondingToServerRequest,
    resetServerRequests,
    respondToServerRequest,
    serverRequestsState.entries,
  ]);

  const sessionMessage = useMemo<CodexSessionMessageState>(() => {
    return {
      sessionErrorMessage,
      clearSessionErrorMessage: () => {
        setSessionErrorMessage(null);
      },
      reportSessionErrorMessage: (message: string) => {
        setSessionErrorMessage(message);
      },
    };
  }, [sessionErrorMessage]);

  const goals = useMemo<CodexSessionGoalState>(() => {
    return {
      activeGoal,
      activeGoalStatus,
      commandPanel: goalCommandPanel,
      clearCommandPanel: clearGoalCommandPanel,
      confirmReplaceGoal,
      saveEditedGoal,
      executeTypedComposerCommand: executeGoalTypedComposerCommand,
    };
  }, [
    activeGoal,
    activeGoalStatus,
    clearGoalCommandPanel,
    confirmReplaceGoal,
    executeGoalTypedComposerCommand,
    goalCommandPanel,
    saveEditedGoal,
  ]);

  const plans = useMemo<CodexSessionPlanState>(() => {
    return {
      activeMode: activePlanMode,
      clearContextImplementationThreadId,
      acknowledgeClearContextImplementationThread: (threadId) => {
        setClearContextImplementationThreadId((currentThreadId) =>
          currentThreadId === threadId ? null : currentThreadId,
        );
      },
      commandPanel: planCommandPanel,
      executeTypedComposerCommand: (commandInput) => {
        if (commandInput.commandId !== CodexComposerCommandIds.PLAN) {
          setSessionErrorMessage(`Unsupported Codex runtime command '${commandInput.text}'.`);
          return false;
        }

        if (commandInput.text.trim() !== "/plan") {
          setSessionErrorMessage(`Unsupported Codex runtime command '${commandInput.text}'.`);
          return false;
        }

        switchActiveThreadToPlanMode();
        return true;
      },
      switchActiveThreadToDefault: switchActiveThreadToDefaultMode,
    };
  }, [
    activePlanMode,
    clearContextImplementationThreadId,
    planCommandPanel,
    switchActiveThreadToDefaultMode,
    switchActiveThreadToPlanMode,
  ]);

  const reviews = useMemo<CodexSessionReviewState>(() => {
    return {
      commandPanel: reviewCommandPanelView,
      clearCommandPanel: cancelReviewTargetLoad,
      executeTypedComposerCommand: executeReviewTypedComposerCommand,
    };
  }, [cancelReviewTargetLoad, executeReviewTypedComposerCommand, reviewCommandPanelView]);

  return {
    lifecycle,
    repositoryStatusRefreshEpoch,
    threadTokenUsageSnapshot,
    threadAuthority,
    threads,
    chat,
    bootstrap,
    codexBootstrapData,
    codexConfig,
    serverRequests,
    sessionMessage,
    goals,
    plans,
    reviews,
  };
}
