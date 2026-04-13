import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import {
  archiveCodexThread,
  compactCodexThread,
  forkCodexThread,
  listCodexThreads,
  rollbackCodexThread,
  resumeCodexThread,
  startCodexThread,
  unarchiveCodexThread,
  unsubscribeCodexThread,
  type CodexJsonRpcClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcServerRequest,
  type AgentStreamClient,
  type CodexThreadSummary,
  type CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useRef, useState, type RefObject } from "react";

import { getSandboxInstanceStatusQueryKey } from "../../../pages/use-session-workbench-lifecycle-state.js";
import { patchSandboxInstanceTitle } from "../../../sessions/sessions-service.js";
import {
  createInitialCodexApprovalRequestsState,
  reduceCodexApprovalRequestsState,
  type CodexApprovalRequestEntry,
} from "../approvals/codex-approval-requests-state.js";
import { parseThreadNameUpdate } from "./codex-session-events.js";
import { type ConnectedCodexSession, type StartSessionStep } from "./codex-session-types.js";
import { readCodexThreadState } from "./codex-thread-read-state.js";
import { resolvePrimaryRepositoryThreadSwitchAction } from "./primary-repository-thread-switch.js";
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
import { resolveThreadTitlePatchInput } from "./thread-title-updates.js";
import { useCodexChatController, type CodexChatState } from "./use-codex-chat-controller.js";
import { useCodexThreadCollections } from "./use-codex-thread-collections.js";

export type { ConnectedCodexSession, StartSessionStep };

type CodexSessionThreadState = {
  availableThreads: readonly CodexThreadSummary[];
  archivedThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  isRefreshingThreads: boolean;
  isRefreshingLoadedThreads: boolean;
  isRefreshingArchivedThreads: boolean;
  isStartingNewThread: boolean;
  isResumingThread: boolean;
  isSwitchingPrimaryRepository: boolean;
  isForkingThread: boolean;
  isArchivingThread: boolean;
  isUnarchivingThread: boolean;
  isUnsubscribingThread: boolean;
  isCompactingThread: boolean;
  isRollingBackThread: boolean;
  refreshThreadList: () => void;
  refreshLoadedThreadList: () => void;
  refreshArchivedThreadList: () => void;
  startNewThread: () => Promise<string>;
  resumeThread: (threadId: string) => Promise<string>;
  forkThread: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
  unarchiveThread: (threadId: string) => void;
  unsubscribeThread: (threadId: string) => void;
  compactThread: (threadId: string) => void;
  rollbackThread: (threadId: string, numTurns: number) => void;
  switchPrimaryRepository: (selectedRepositoryPath: string | null) => Promise<string>;
};

type CodexSessionChatState = {
  chatState: CodexChatState;
  isStartingTurn: boolean;
  isReloadingChat: boolean;
  isInterruptingTurn: boolean;
  isSteeringTurn: boolean;
  canInterruptTurn: boolean;
  canSteerTurn: boolean;
  hydrateChatFromThread: () => Promise<void>;
  startTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
  interruptTurn: () => void;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
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

export type UseCodexSessionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
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
  const queryClient = useQueryClient();
  const rpcClientRef = input.rpcClientRef;
  const sessionSnapshotRef = useRef<ConnectedCodexSession | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);

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
    archivedThreads,
    loadedThreadIds,
    refreshThreadList,
    refreshArchivedThreadList,
    refreshLoadedThreadList,
    refreshThreadCollections,
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
    canInterruptTurn,
    canSteerTurn,
    startTurn,
    reloadChat,
    interruptTurn,
    steerTurn,
  } = useCodexChatController({
    rpcClientRef: input.rpcClientRef,
    threadIdRef,
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

  const patchThreadTitleMutation = useMutation({
    mutationFn: async (input: { sandboxInstanceId: string; title: string }) => {
      return patchSandboxInstanceTitle({
        instanceId: input.sandboxInstanceId,
        title: input.title,
      });
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ["sandbox-instances", "list"],
        }),
      ]);
    },
    onError: (error) => {
      setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not update sandbox session title.",
      );
    },
  });

  const handleSessionNotificationReceived = useCallback(
    (notification: CodexJsonRpcNotification) => {
      const threadNameUpdate = parseThreadNameUpdate(notification);
      const patchInput = resolveThreadTitlePatchInput({
        sessionSnapshot: sessionSnapshotRef.current,
        threadNameUpdate,
      });
      if (patchInput === null) {
        return;
      }

      patchThreadTitleMutation.mutate(patchInput);
    },
    [patchThreadTitleMutation],
  );

  const handleServerRequestReceived = useCallback((request: CodexJsonRpcServerRequest) => {
    dispatchServerRequestsAction({
      type: "server_request_received",
      request,
    });
  }, []);

  const { lifecycle, updateActiveThread } = useCodexSessionConnection({
    connectionGenerationRef,
    ensureCurrentGeneration,
    handleChatNotificationReceived: handleNotificationReceived,
    handleSessionNotificationReceived,
    onServerRequestNotification: handleServerRequestNotification,
    onServerRequestReceived: handleServerRequestReceived,
    refreshThreadCollections,
    ensureTransportConnected: input.ensureTransportConnected,
    rpcClientRef: input.rpcClientRef,
    sessionClientRef: input.sessionClientRef,
    sessionEventUnsubscribersRef: input.sessionEventUnsubscribersRef,
    lifecycleErrorMessage,
    setLifecycleErrorMessage,
    threadIdRef,
  });
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
    loadModelsAsync,
    readConfigAsync,
    rpcClientRef: input.rpcClientRef,
  });

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
    onSuccess: (threadStart) => {
      updateActiveThread(threadStart.threadId);
      resetChat();
      setLifecycleErrorMessage(null);
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not start a new thread.", error);
    },
  });

  const resumeThreadMutation = useMutation({
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
    onSuccess: (result) => {
      updateActiveThread(result.threadId);
      resetChat();
      setLifecycleErrorMessage(null);
      void hydrateChatFromThread();
      refreshThreadCollectionsWithErrorHandling();
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not resume thread.", error);
    },
  });

  const switchPrimaryRepositoryMutation = useMutation({
    mutationFn: async (selectedRepositoryPath: string | null) => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before switching the primary repository.");
      }

      const matchingThreads = await listCodexThreads({
        cwd: selectedRepositoryPath ?? DefaultSandboxWorkspaceDir,
        limit: 20,
        rpcClient,
        sortKey: "updated_at",
      });
      const switchAction = resolvePrimaryRepositoryThreadSwitchAction({
        matchingThreads: matchingThreads.threads,
        selectedRepositoryPath,
      });

      if (switchAction.type === "resume_existing_thread") {
        const result = await resumeThreadMutateAsync(switchAction.threadId);
        return result.threadId;
      }

      const result = await startNewThreadMutateAsync({
        cwd: switchAction.cwd,
      });
      return result.threadId;
    },
    onError: (error) => {
      handleThreadMutationFailure("Could not switch the primary repository.", error);
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
      updateActiveThread(result.threadId);
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

      return unarchiveCodexThread({
        rpcClient,
        threadId,
      });
    },
    onSuccess: (result) => {
      updateActiveThread(result.threadId);
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
      updateActiveThread(result.threadId);
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
  const {
    mutateAsync: switchPrimaryRepositoryMutateAsync,
    isPending: isSwitchingPrimaryRepository,
  } = switchPrimaryRepositoryMutation;
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

  const startNewThread = useCallback(async (): Promise<string> => {
    const result = await startNewThreadMutateAsync(undefined);
    return result.threadId;
  }, [startNewThreadMutateAsync]);

  const resumeThread = useCallback(
    async (threadId: string): Promise<string> => {
      const result = await resumeThreadMutateAsync(threadId);
      return result.threadId;
    },
    [resumeThreadMutateAsync],
  );

  const switchPrimaryRepository = useCallback(
    async (selectedRepositoryPath: string | null): Promise<string> => {
      return await switchPrimaryRepositoryMutateAsync(selectedRepositoryPath);
    },
    [switchPrimaryRepositoryMutateAsync],
  );

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
      throw new Error("Connect to a sandbox session before starting Codex CLI.");
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
        `The linked provider conversation '${providerThreadId}' is not resumable for Codex CLI.`,
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
      updateActiveThread(null);
    },
    [lifecycle.sessionSnapshot?.providerThreadId, updateActiveThread],
  );

  const threads = useMemo<CodexSessionThreadState>(() => {
    return {
      availableThreads,
      archivedThreads,
      loadedThreadIds,
      isRefreshingThreads,
      isRefreshingLoadedThreads,
      isRefreshingArchivedThreads,
      isStartingNewThread,
      isResumingThread,
      isSwitchingPrimaryRepository,
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
      switchPrimaryRepository,
    };
  }, [
    archiveThread,
    archivedThreads,
    availableThreads,
    compactThread,
    forkThread,
    isArchivingThread,
    isCompactingThread,
    isForkingThread,
    isRefreshingArchivedThreads,
    isRefreshingLoadedThreads,
    isRefreshingThreads,
    isResumingThread,
    isSwitchingPrimaryRepository,
    isRollingBackThread,
    isStartingNewThread,
    isUnarchivingThread,
    isUnsubscribingThread,
    loadedThreadIds,
    refreshAvailableThreads,
    refreshLoadedThreads,
    refreshArchivedThreads,
    resumeThread,
    rollbackThread,
    startNewThread,
    switchPrimaryRepository,
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
      canInterruptTurn,
      canSteerTurn,
      hydrateChatFromThread,
      startTurn,
      interruptTurn,
      steerTurn,
      reloadChat,
    };
  }, [
    canInterruptTurn,
    canSteerTurn,
    hydrateChatFromThread,
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
      loadModelsAsync,
      readConfigAsync,
    };
  }, [
    availableModels,
    configJson,
    configStatus,
    isLoadingModels,
    isReadingConfig,
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

  return {
    lifecycle,
    threadAuthority,
    threads,
    chat,
    bootstrap,
    codexBootstrapData,
    codexConfig,
    serverRequests,
    sessionMessage,
  };
}
