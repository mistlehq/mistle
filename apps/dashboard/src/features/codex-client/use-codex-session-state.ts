import {
  archiveCodexThread,
  CodexJsonRpcClient,
  CodexSessionClient,
  compactCodexThread,
  forkCodexThread,
  rollbackCodexThread,
  resumeCodexThread,
  startCodexThread,
  unarchiveCodexThread,
  unsubscribeCodexThread,
  type CodexSessionConnectionState,
  type CodexExperimentalFeatureSummary,
  type CodexExternalAgentMigrationItem,
  type CodexModelSummary,
  type CodexThreadSummary,
  createBrowserCodexSessionRuntime,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { mintSandboxInstanceConnectionToken } from "../sessions/sessions-service.js";
import {
  createInitialCodexServerRequestsState,
  reduceCodexServerRequestsState,
  type CodexServerRequestEntry,
} from "./codex-server-requests-state.js";
import {
  parseThreadLifecycleEvent,
  parseThreadTokenUsageSnapshot,
  parseTurnDiffSnapshot,
  parseTurnPlanSnapshot,
} from "./codex-session-events.js";
import {
  resolveCodexConnectionStateTransition,
  selectCodexConnectionThreadStrategy,
} from "./codex-session-lifecycle-policy.js";
import {
  type CodexThreadLifecycleEvent,
  type CodexThreadTokenUsageSnapshot,
  type CodexTurnDiffSnapshot,
  type CodexTurnPlanSnapshot,
  type ConnectedCodexSession,
  type StartSessionStep,
} from "./codex-session-types.js";
import { useCodexChatController, type CodexChatState } from "./use-codex-chat-controller.js";
import { useCodexSessionAdmin } from "./use-codex-session-admin.js";
import { useCodexSessionDebugState } from "./use-codex-session-debug-state.js";
import { useCodexThreadCollections } from "./use-codex-thread-collections.js";

function describeStepError(stepLabel: string, error: unknown): Error {
  if (error instanceof Error && error.message.trim().length > 0) {
    return new Error(`${stepLabel} failed: ${error.message}`);
  }

  return new Error(`${stepLabel} failed.`);
}

class StaleConnectionAttemptError extends Error {
  constructor() {
    super("Stale connection attempt.");
  }
}

export type {
  ConnectedCodexSession,
  CodexThreadLifecycleEvent,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
  StartSessionStep,
};

type CodexSessionLifecycleState = {
  step: StartSessionStep;
  startErrorMessage: string | null;
  connectedSession: ConnectedCodexSession | null;
  agentConnectionState: CodexSessionConnectionState;
  agentConnectionError: string | null;
  isStartingSession: boolean;
  connectSession: (input: { sandboxInstanceId: string }) => void;
  disconnectSession: () => void;
  clearStartErrorMessage: () => void;
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
  startTurn: (prompt: string) => void;
  interruptTurn: () => void;
  steerTurn: (prompt: string) => void;
  reloadChat: () => void;
};

type CodexSessionAdminState = {
  availableModels: readonly CodexModelSummary[];
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
  loadExperimentalFeatures: () => void;
  readConfig: (includeLayers: boolean) => void;
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
  pendingServerRequests: readonly CodexServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  respondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export type UseCodexSessionStateResult = {
  lifecycle: CodexSessionLifecycleState;
  threads: CodexSessionThreadState;
  chat: CodexSessionChatState;
  admin: CodexSessionAdminState;
  debug: CodexSessionDebugState;
  serverRequests: CodexSessionServerRequestState;
};

export function useCodexSessionState(): UseCodexSessionStateResult {
  const sessionClientRef = useRef<CodexSessionClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);
  const threadIdRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);

  const [step, setStep] = useState<StartSessionStep>("idle");
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);
  const [connectedSession, setConnectedSession] = useState<ConnectedCodexSession | null>(null);
  const [agentConnectionState, setAgentConnectionState] =
    useState<CodexSessionConnectionState>("idle");
  const [agentConnectionError, setAgentConnectionError] = useState<string | null>(null);
  const [serverRequestsState, dispatchServerRequestsAction] = useReducer(
    reduceCodexServerRequestsState,
    undefined,
    createInitialCodexServerRequestsState,
  );
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

  const adminState = useCodexSessionAdmin({
    rpcClientRef,
    recordRecentResponse,
    setStartErrorMessage,
  });
  const {
    availableModels,
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
    loadExperimentalFeatures,
    readConfig,
    readConfigRequirements,
    writeConfigValue,
    batchWriteConfig,
    detectExternalAgentConfig,
    importExternalAgentConfig,
    resetAdminState,
  } = adminState;

  const resetSessionState = useCallback((): void => {
    threadIdRef.current = null;
    setConnectedSession(null);
    resetThreadCollections();
    resetAdminState();
    setStep("idle");
    setStartErrorMessage(null);
    setAgentConnectionState("idle");
    setAgentConnectionError(null);
    resetDebugState();
    dispatchServerRequestsAction({ type: "reset" });
    resetChat();
  }, [resetAdminState, resetDebugState, resetThreadCollections, resetChat]);

  const teardownConnection = useCallback((reason: string): void => {
    for (const unsubscribe of sessionEventUnsubscribersRef.current) {
      unsubscribe();
    }
    sessionEventUnsubscribersRef.current = [];
    rpcClientRef.current?.dispose();
    rpcClientRef.current = null;
    sessionClientRef.current?.disconnect(1000, reason);
    sessionClientRef.current = null;
  }, []);

  const disconnectSession = useCallback((): void => {
    connectionGenerationRef.current += 1;
    teardownConnection("Disconnected from sessions page.");
    resetSessionState();
  }, [resetSessionState, teardownConnection]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  function ensureCurrentGeneration(generation: number): void {
    if (connectionGenerationRef.current !== generation) {
      throw new StaleConnectionAttemptError();
    }
  }

  function updateActiveThread(threadId: string | null): void {
    threadIdRef.current = threadId;
    setConnectedSession((current) => {
      if (current === null) {
        return current;
      }

      return {
        ...current,
        threadId,
      };
    });
  }

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

  function attachProtocolListeners(input: {
    sessionClient: CodexSessionClient;
    rpcClient: CodexJsonRpcClient;
    generation: number;
  }): void {
    sessionClientRef.current = input.sessionClient;
    rpcClientRef.current = input.rpcClient;

    sessionEventUnsubscribersRef.current = [
      input.sessionClient.onEvent((event) => {
        if (connectionGenerationRef.current !== input.generation) {
          return;
        }

        if (event.type === "connection_state_changed") {
          setAgentConnectionState(event.state);
          setAgentConnectionError(event.errorMessage);
          const connectionStateTransition = resolveCodexConnectionStateTransition({
            state: event.state,
            errorMessage: event.errorMessage ?? null,
          });
          if (connectionStateTransition.shouldResetSession) {
            connectionGenerationRef.current += 1;
            teardownConnection("Disconnected from Codex session.");
            resetSessionState();
            setStartErrorMessage(connectionStateTransition.startErrorMessage);
          }
          return;
        }

        if (event.type === "response") {
          recordRecentResponse(event.response);
          return;
        }

        if (event.type === "notification") {
          const threadLifecycleEvent = parseThreadLifecycleEvent(event.notification);
          if (threadLifecycleEvent !== null) {
            recordThreadLifecycleEvent(threadLifecycleEvent);
          }

          const turnDiffSnapshot = parseTurnDiffSnapshot(event.notification);
          if (turnDiffSnapshot !== null) {
            recordTurnDiffSnapshot(turnDiffSnapshot);
          }

          const turnPlanSnapshot = parseTurnPlanSnapshot(event.notification);
          if (turnPlanSnapshot !== null) {
            recordTurnPlanSnapshot(turnPlanSnapshot);
          }

          const threadTokenUsageSnapshot = parseThreadTokenUsageSnapshot(event.notification);
          if (threadTokenUsageSnapshot !== null) {
            recordThreadTokenUsageSnapshot(threadTokenUsageSnapshot);
          }

          dispatchServerRequestsAction({
            type: "notification_received",
            notification: event.notification,
          });
          handleNotificationReceived(event.notification);
          if (event.notification.method === "turn/completed") {
            void refreshThreadCollections({ generation: input.generation }).catch(
              (error: unknown) => {
                setStartErrorMessage(
                  error instanceof Error ? error.message : "Could not refresh thread collections.",
                );
              },
            );
          }
          recordRecentNotification(event.notification);
          return;
        }

        if (event.type === "server_request") {
          dispatchServerRequestsAction({
            type: "server_request_received",
            request: event.request,
          });
          recordRecentServerRequest(event.request);
          return;
        }

        recordRecentUnhandledMessage(event.payload);
      }),
    ];
  }

  const connectSessionMutation = useMutation({
    mutationFn: async (input: { sandboxInstanceId: string }) => {
      const generation = connectionGenerationRef.current + 1;
      connectionGenerationRef.current = generation;
      teardownConnection("Superseded by a new Codex session.");
      resetSessionState();
      setStartErrorMessage(null);
      setStep("securing");

      let mintedConnection;
      try {
        mintedConnection = await mintSandboxInstanceConnectionToken({
          instanceId: input.sandboxInstanceId,
        });
        ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeStepError("Minting sandbox connection token", error);
      }

      const sessionClient = new CodexSessionClient({
        connectionUrl: mintedConnection.connectionUrl,
        runtime: createBrowserCodexSessionRuntime(),
      });
      const rpcClient = new CodexJsonRpcClient(sessionClient);
      attachProtocolListeners({
        sessionClient,
        rpcClient,
        generation,
      });

      setStep("connecting");
      try {
        await sessionClient.connect();
        ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeStepError("Connecting to sandbox agent channel", error);
      }

      try {
        await rpcClient.initialize();
        ensureCurrentGeneration(generation);
      } catch (error) {
        sessionClient.disconnect(1000, "Initialization failed.");
        throw describeStepError("Initializing Codex app server", error);
      }

      const threadCollections = await refreshThreadCollections({
        rpcClient,
        generation,
      });
      const connectionThreadStrategy = selectCodexConnectionThreadStrategy({
        availableThreads: threadCollections.availableThreads,
        loadedThreadIds: threadCollections.loadedThreadIds,
      });

      if (connectionThreadStrategy.type === "resume") {
        const resumedThread = await resumeCodexThread({
          rpcClient,
          threadId: connectionThreadStrategy.threadId,
        });
        ensureCurrentGeneration(generation);

        return {
          generation,
          sandboxInstanceId: input.sandboxInstanceId,
          mintedConnection,
          threadId: resumedThread.threadId,
        };
      }

      const threadStart = await startCodexThread({
        rpcClient,
        model: "gpt-5.3-codex",
      });
      ensureCurrentGeneration(generation);

      return {
        generation,
        sandboxInstanceId: input.sandboxInstanceId,
        mintedConnection,
        threadId: threadStart.threadId,
      };
    },
    onSuccess: (result) => {
      if (connectionGenerationRef.current !== result.generation) {
        return;
      }

      updateActiveThread(result.threadId);
      resetChat();
      setConnectedSession({
        sandboxInstanceId: result.sandboxInstanceId,
        connectedAtIso: new Date().toISOString(),
        expiresAtIso: result.mintedConnection.connectionExpiresAt,
        threadId: result.threadId,
      });
      setAgentConnectionState("ready");
      setAgentConnectionError(null);
      setStep("connected");
      setStartErrorMessage(null);
      void hydrateChatFromThread({
        threadId: result.threadId,
        ensureCurrentGeneration,
      });
    },
    onError: (error) => {
      if (error instanceof StaleConnectionAttemptError) {
        return;
      }

      disconnectSession();
      setStep("idle");
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not establish sandbox session.",
      );
    },
  });

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

  const { mutate: connectSessionMutate, isPending: isStartingSession } = connectSessionMutation;
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

  const connectSession = useCallback(
    (input: { sandboxInstanceId: string }) => {
      connectSessionMutate(input);
    },
    [connectSessionMutate],
  );

  const clearStartErrorMessage = useCallback(() => {
    setStartErrorMessage(null);
  }, []);

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

  const lifecycle = useMemo<CodexSessionLifecycleState>(() => {
    return {
      step,
      startErrorMessage,
      connectedSession,
      agentConnectionState,
      agentConnectionError,
      isStartingSession,
      connectSession,
      disconnectSession,
      clearStartErrorMessage,
    };
  }, [
    agentConnectionError,
    agentConnectionState,
    clearStartErrorMessage,
    connectSession,
    isStartingSession,
    connectedSession,
    disconnectSession,
    startErrorMessage,
    step,
  ]);

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
      startTurn,
      interruptTurn,
      steerTurn,
      reloadChat,
    };
  }, [
    canInterruptTurn,
    canSteerTurn,
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

  const admin = useMemo<CodexSessionAdminState>(() => {
    return {
      availableModels,
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
      loadExperimentalFeatures,
      readConfig,
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
    configRequirementsJson,
    detectExternalAgentConfig,
    detectedExternalAgentMigrationItems,
    experimentalFeatures,
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
    readConfig,
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
    admin,
    debug,
    serverRequests,
  };
}
