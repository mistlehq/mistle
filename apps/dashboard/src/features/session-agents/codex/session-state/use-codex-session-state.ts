import {
  archiveCodexThread,
  compactCodexThread,
  forkCodexThread,
  rollbackCodexThread,
  resumeCodexThread,
  startCodexThread,
  unarchiveCodexThread,
  unsubscribeCodexThread,
  type CodexJsonRpcClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcServerRequest,
  type CodexSessionClient,
  type CodexThreadSummary,
  type CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";

import {
  createInitialCodexApprovalRequestsState,
  reduceCodexApprovalRequestsState,
  type CodexApprovalRequestEntry,
} from "../approvals/codex-approval-requests-state.js";
import { type ConnectedCodexSession, type StartSessionStep } from "./codex-session-types.js";
import {
  useCodexSessionBootstrapData,
  useSessionBootstrap,
  type CodexSessionBootstrapDataState,
  type CodexSessionConfigState,
  type SessionBootstrapResult,
} from "./session-bootstrap/index.js";
import {
  StaleConnectionAttemptError,
  useCodexSessionConnection,
  type CodexSessionConnectionLifecycleState,
} from "./session-connection/index.js";
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
  isForkingThread: boolean;
  isArchivingThread: boolean;
  isUnarchivingThread: boolean;
  isUnsubscribingThread: boolean;
  isCompactingThread: boolean;
  isRollingBackThread: boolean;
  refreshThreadList: () => void;
  refreshLoadedThreadList: () => void;
  refreshArchivedThreadList: () => void;
  startNewThread: () => void;
  resumeThread: (threadId: string) => void;
  forkThread: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
  unarchiveThread: (threadId: string) => void;
  unsubscribeThread: (threadId: string) => void;
  compactThread: (threadId: string) => void;
  rollbackThread: (threadId: string, numTurns: number) => void;
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
};

type CodexSessionMessageState = {
  clearSessionErrorMessage: () => void;
  reportSessionErrorMessage: (message: string) => void;
  sessionErrorMessage: string | null;
};

export type UseCodexSessionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  threads: CodexSessionThreadState;
  chat: CodexSessionChatState;
  bootstrap: SessionBootstrapResult;
  codexBootstrapData: CodexSessionBootstrapDataState;
  codexConfig: CodexSessionConfigState;
  serverRequests: CodexSessionServerRequestState;
  sessionMessage: CodexSessionMessageState;
};

export function useCodexSessionState(): UseCodexSessionStateResult {
  const sessionClientRef = useRef<CodexSessionClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);
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
    rpcClientRef,
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
    rpcClientRef,
    threadIdRef,
    setSessionErrorMessage,
  });

  const bootstrapDataState = useCodexSessionBootstrapData({
    rpcClientRef,
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
    onServerRequestNotification: handleServerRequestNotification,
    onServerRequestReceived: handleServerRequestReceived,
    refreshThreadCollections,
    rpcClientRef,
    sessionClientRef,
    sessionEventUnsubscribersRef,
    lifecycleErrorMessage,
    setLifecycleErrorMessage,
    threadIdRef,
  });
  const { connectedSession } = lifecycle;

  const bootstrap = useSessionBootstrap({
    connectedSession,
    ensureCurrentGeneration,
    hydrateInitialThread,
    loadModelsAsync,
    readConfigAsync,
    rpcClientRef,
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
    mutationFn: async () => {
      const rpcClient = rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before starting a new thread.");
      }

      const threadStart = await startCodexThread({
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
  const { mutate: startNewThreadMutate, isPending: isStartingNewThread } = startNewThreadMutation;
  const { mutate: resumeThreadMutate, isPending: isResumingThread } = resumeThreadMutation;
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

  const startNewThread = useCallback(() => {
    startNewThreadMutate();
  }, [startNewThreadMutate]);

  const resumeThread = useCallback(
    (threadId: string) => {
      resumeThreadMutate(threadId);
    },
    [resumeThreadMutate],
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
    unarchiveThread,
    unsubscribeThread,
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
    };
  }, [isRespondingToServerRequest, respondToServerRequest, serverRequestsState.entries]);

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
    threads,
    chat,
    bootstrap,
    codexBootstrapData,
    codexConfig,
    serverRequests,
    sessionMessage,
  };
}
