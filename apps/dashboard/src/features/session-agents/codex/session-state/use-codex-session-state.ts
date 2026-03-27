import {
  archiveCodexThread,
  compactCodexThread,
  forkCodexThread,
  rollbackCodexThread,
  resumeCodexThread,
  startCodexThread,
  unarchiveCodexThread,
  unsubscribeCodexThread,
  type CodexExperimentalFeatureSummary,
  type CodexExternalAgentMigrationItem,
  type CodexJsonRpcClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcServerRequest,
  type CodexModelSummary,
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
import { StaleConnectionAttemptError } from "./codex-session-errors.js";
import {
  type CodexThreadLifecycleEvent,
  type CodexThreadTokenUsageSnapshot,
  type CodexTurnDiffSnapshot,
  type CodexTurnPlanSnapshot,
  type ConnectedCodexSession,
  type StartSessionStep,
} from "./codex-session-types.js";
import { useCodexChatController, type CodexChatState } from "./use-codex-chat-controller.js";
import {
  useCodexSessionBootstrapData,
  type CodexConfigStatus,
  type CodexModelCatalogStatus,
} from "./use-codex-session-bootstrap-data.js";
import {
  useCodexSessionBootstrap,
  type CodexSessionBootstrapState,
} from "./use-codex-session-bootstrap.js";
import {
  useCodexSessionConnection,
  type CodexSessionConnectionLifecycleState,
} from "./use-codex-session-connection.js";
import { useCodexSessionDebugState } from "./use-codex-session-debug-state.js";
import { useCodexThreadCollections } from "./use-codex-thread-collections.js";

export type {
  ConnectedCodexSession,
  CodexThreadLifecycleEvent,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
  StartSessionStep,
};

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

type CodexSessionBootstrapDataState = {
  availableModels: readonly CodexModelSummary[];
  modelCatalogStatus: CodexModelCatalogStatus;
  configStatus: CodexConfigStatus;
  experimentalFeatures: readonly CodexExperimentalFeatureSummary[];
  configJson: string | null;
  configRequirementsJson: string | null;
  detectedExternalAgentMigrationItems: readonly CodexExternalAgentMigrationItem[];
  isLoadingModels: boolean;
  isLoadingExperimentalFeatures: boolean;
  isReadingConfig: boolean;
  isReadingConfigRequirements: boolean;
  isWritingConfigValue: boolean;
  isBatchWritingConfig: boolean;
  isDetectingExternalAgentConfig: boolean;
  isImportingExternalAgentConfig: boolean;
  loadModels: () => void;
  loadModelsAsync: () => Promise<{ models: readonly CodexModelSummary[]; response: unknown }>;
  loadExperimentalFeatures: () => void;
  readConfig: (includeLayers: boolean) => void;
  readConfigAsync: (includeLayers: boolean) => Promise<{ config: unknown; response: unknown }>;
  readConfigRequirements: () => void;
  writeConfigValue: (input: {
    keyPath: string;
    value: unknown;
    mergeStrategy: "replace" | "upsert";
  }) => void;
  batchWriteConfig: (input: {
    edits: readonly {
      keyPath: string;
      value: unknown;
      mergeStrategy: "replace" | "upsert";
    }[];
  }) => void;
  detectExternalAgentConfig: (input: { includeHome: boolean; cwds: readonly string[] }) => void;
  importExternalAgentConfig: (items: readonly CodexExternalAgentMigrationItem[]) => void;
};

type CodexSessionDebugState = {
  threadLifecycleEvents: readonly CodexThreadLifecycleEvent[];
  turnDiffSnapshots: readonly CodexTurnDiffSnapshot[];
  turnPlanSnapshots: readonly CodexTurnPlanSnapshot[];
  threadTokenUsageSnapshots: readonly CodexThreadTokenUsageSnapshot[];
  recentNotifications: readonly string[];
  recentResponses: readonly string[];
  recentServerRequests: readonly string[];
  recentUnhandledMessages: readonly string[];
};

type CodexSessionServerRequestState = {
  pendingServerRequests: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  respondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export type UseCodexSessionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  threads: CodexSessionThreadState;
  chat: CodexSessionChatState;
  bootstrap: CodexSessionBootstrapState;
  bootstrapData: CodexSessionBootstrapDataState;
  debug: CodexSessionDebugState;
  serverRequests: CodexSessionServerRequestState;
};

export function useCodexSessionState(): UseCodexSessionStateResult {
  const sessionClientRef = useRef<CodexSessionClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);
  const threadIdRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);

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
  const debugState = useCodexSessionDebugState();
  const {
    recordRecentNotification,
    recordRecentResponse,
    recordRecentServerRequest,
    recordRecentUnhandledMessage,
    recordThreadLifecycleEvent,
    recordTurnDiffSnapshot,
    recordTurnPlanSnapshot,
    recordThreadTokenUsageSnapshot,
    resetDebugState,
  } = debugState;

  const {
    availableThreads,
    archivedThreads,
    loadedThreadIds,
    refreshThreadList,
    refreshArchivedThreadList,
    refreshLoadedThreadList,
    refreshThreadCollections,
    resetThreadCollections,
  } = useCodexThreadCollections({
    rpcClientRef,
    ensureCurrentGeneration,
    recordRecentResponse,
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
    recordRecentResponse,
    setStartErrorMessage,
  });

  const bootstrapDataState = useCodexSessionBootstrapData({
    rpcClientRef,
    recordRecentResponse,
    setStartErrorMessage,
  });
  const {
    availableModels,
    modelCatalogStatus,
    configStatus,
    experimentalFeatures,
    configJson,
    configRequirementsJson,
    detectedExternalAgentMigrationItems,
    isLoadingModels,
    isLoadingExperimentalFeatures,
    isReadingConfig,
    isReadingConfigRequirements,
    isWritingConfigValue,
    isBatchWritingConfig,
    isDetectingExternalAgentConfig,
    isImportingExternalAgentConfig,
    loadModels,
    loadModelsAsync,
    loadExperimentalFeatures,
    readConfig,
    readConfigAsync,
    readConfigRequirements,
    writeConfigValue,
    batchWriteConfig,
    detectExternalAgentConfig,
    importExternalAgentConfig,
    resetBootstrapData,
  } = bootstrapDataState;
  const resetSessionData = useCallback((): void => {
    threadIdRef.current = null;
    resetThreadCollections();
    resetBootstrapData();
    resetDebugState();
    dispatchServerRequestsAction({ type: "reset" });
    resetChat();
  }, [resetBootstrapData, resetDebugState, resetThreadCollections, resetChat]);

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
    recordRecentNotification,
    recordRecentResponse,
    recordRecentServerRequest,
    recordRecentUnhandledMessage,
    recordThreadLifecycleEvent,
    recordThreadTokenUsageSnapshot,
    recordTurnDiffSnapshot,
    recordTurnPlanSnapshot,
    refreshThreadCollections,
    resetSessionData,
    resetChat,
    rpcClientRef,
    sessionClientRef,
    sessionEventUnsubscribersRef,
    startErrorMessage,
    setStartErrorMessage,
    threadIdRef,
  });
  const { connectedSession } = lifecycle;

  const bootstrap = useCodexSessionBootstrap({
    connectedSession,
    ensureCurrentGeneration,
    hydrateInitialThread,
    loadModelsAsync,
    readConfigAsync,
    rpcClientRef,
  });

  const handleThreadMutationFailure = useCallback(
    (fallbackMessage: string, error: unknown): void => {
      setStartErrorMessage(error instanceof Error ? error.message : fallbackMessage);
    },
    [],
  );

  const refreshThreadCollectionsWithErrorHandling = useCallback((): void => {
    void refreshThreadCollections().catch((error: unknown) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not refresh thread collections.",
      );
    });
  }, [refreshThreadCollections]);

  const refreshLoadedThreadListWithErrorHandling = useCallback((): void => {
    void refreshLoadedThreadList().catch((error: unknown) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not refresh loaded thread list.",
      );
    });
  }, [refreshLoadedThreadList]);

  const refreshThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshThreadList();
    },
    onError: (error) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not refresh thread list.",
      );
    },
  });

  const refreshArchivedThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshArchivedThreadList();
    },
    onError: (error) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not refresh archived thread list.",
      );
    },
  });

  const refreshLoadedThreadListMutation = useMutation({
    mutationFn: async () => {
      await refreshLoadedThreadList();
    },
    onError: (error) => {
      setStartErrorMessage(
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
      setStartErrorMessage(null);
      recordRecentResponse(threadStart.response);
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
      setStartErrorMessage(null);
      recordRecentResponse(result.response);
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
      setStartErrorMessage(
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
      recordRecentResponse(result.response);
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
    onSuccess: (result, threadId) => {
      recordRecentResponse(result.response);
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
      recordRecentResponse(result.response);
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
    onSuccess: (result) => {
      recordRecentResponse(result.response);
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
    onSuccess: (result) => {
      recordRecentResponse(result.response);
    },
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
      recordRecentResponse(result.response);
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

  const bootstrapData = useMemo<CodexSessionBootstrapDataState>(() => {
    return {
      availableModels,
      modelCatalogStatus,
      configStatus,
      experimentalFeatures,
      configJson,
      configRequirementsJson,
      detectedExternalAgentMigrationItems,
      isLoadingModels,
      isLoadingExperimentalFeatures,
      isReadingConfig,
      isReadingConfigRequirements,
      isWritingConfigValue,
      isBatchWritingConfig,
      isDetectingExternalAgentConfig,
      isImportingExternalAgentConfig,
      loadModels,
      loadModelsAsync,
      loadExperimentalFeatures,
      readConfig,
      readConfigAsync,
      readConfigRequirements,
      writeConfigValue,
      batchWriteConfig,
      detectExternalAgentConfig,
      importExternalAgentConfig,
    };
  }, [
    availableModels,
    batchWriteConfig,
    configJson,
    configStatus,
    configRequirementsJson,
    detectExternalAgentConfig,
    detectedExternalAgentMigrationItems,
    experimentalFeatures,
    modelCatalogStatus,
    importExternalAgentConfig,
    isBatchWritingConfig,
    isDetectingExternalAgentConfig,
    isImportingExternalAgentConfig,
    isLoadingExperimentalFeatures,
    isLoadingModels,
    isReadingConfig,
    isReadingConfigRequirements,
    isWritingConfigValue,
    loadExperimentalFeatures,
    loadModels,
    loadModelsAsync,
    readConfig,
    readConfigAsync,
    readConfigRequirements,
    writeConfigValue,
  ]);

  const debug = useMemo<CodexSessionDebugState>(() => {
    return {
      threadLifecycleEvents: debugState.threadLifecycleEvents,
      turnDiffSnapshots: debugState.turnDiffSnapshots,
      turnPlanSnapshots: debugState.turnPlanSnapshots,
      threadTokenUsageSnapshots: debugState.threadTokenUsageSnapshots,
      recentNotifications: debugState.recentNotifications,
      recentResponses: debugState.recentResponses,
      recentServerRequests: debugState.recentServerRequests,
      recentUnhandledMessages: debugState.recentUnhandledMessages,
    };
  }, [
    debugState.recentNotifications,
    debugState.recentResponses,
    debugState.recentServerRequests,
    debugState.recentUnhandledMessages,
    debugState.threadLifecycleEvents,
    debugState.threadTokenUsageSnapshots,
    debugState.turnDiffSnapshots,
    debugState.turnPlanSnapshots,
  ]);

  const serverRequests = useMemo<CodexSessionServerRequestState>(() => {
    return {
      pendingServerRequests: serverRequestsState.entries,
      isRespondingToServerRequest,
      respondToServerRequest,
    };
  }, [isRespondingToServerRequest, respondToServerRequest, serverRequestsState.entries]);

  return {
    lifecycle,
    threads,
    chat,
    bootstrap,
    bootstrapData,
    debug,
    serverRequests,
  };
}
