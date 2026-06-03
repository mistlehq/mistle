import type {
  CodexJsonRpcClient,
  CodexJsonRpcNotification,
  CodexJsonRpcServerRequest,
  AgentStreamClient,
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  CodexJsonRpcClient as CodexJsonRpcClientConstructor,
  AgentStreamClient as AgentStreamClientConstructor,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { ConnectedCodexSession, StartSessionStep } from "../codex-session-types.js";
import {
  establishCodexThread,
  createConnectedCodexSession,
  establishInitialCodexThread,
} from "./codex-session-connect.js";
import {
  describeCodexSessionStepError,
  getCodexSessionErrorMessage,
  isStaleConnectionAttemptError,
} from "./codex-session-errors.js";
import {
  resolveCodexConnectionStateTransition,
  resolveCodexStreamResetRecoveryStrategy,
} from "./codex-session-lifecycle-policy.js";

type CodexThreadCollectionsRefreshResult = {
  availableThreads: readonly CodexThreadSummary[];
  archivedThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  originalThreadId: string | null;
};

export type CodexConnectionThreadSelectionPolicy = "oldest" | "most_recently_updated";

export type ConnectCodexSessionInput =
  | {
      sandboxInstanceId: string;
      targetThreadId: string;
      initialCwd?: never;
      missingTargetThreadAction?: "start_new";
      providerThreadId?: string | null;
      selectionPolicy?: never;
    }
  | {
      initialCwd?: string | null;
      sandboxInstanceId: string;
      targetThreadId: null;
      providerThreadId?: never;
      selectionPolicy?: CodexConnectionThreadSelectionPolicy;
    };

export type CodexSessionConnectionLifecycleState = {
  step: StartSessionStep;
  lifecycleErrorMessage: string | null;
  sessionSnapshot: ConnectedCodexSession | null;
  sessionConnectionState: "detached" | "connecting" | "connected" | "recovering";
  recoverableDisconnect: {
    id: number;
    isGatewayServiceRestart: boolean;
    message: string;
    targetThreadId: string | null;
    recoveryStrategy: "reconnect_transport" | "reopen_stream";
  } | null;
  agentConnectionState: CodexSessionConnectionState;
  agentConnectionError: string | null;
  isStartingSession: boolean;
  connectSession: (input: ConnectCodexSessionInput) => void;
  recoverSession: (input: { sandboxInstanceId: string; targetThreadId: string | null }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  clearLifecycleErrorMessage: () => void;
  reportLifecycleErrorMessage: (message: string) => void;
};

export type ActiveCodexThreadUpdate = {
  threadId: string | null;
  cwd?: string;
};

export type CodexSessionConnectionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  updateActiveThread: (input: ActiveCodexThreadUpdate) => void;
};

export function updateConnectedCodexSessionActiveThread(
  input: {
    currentSession: ConnectedCodexSession;
  } & ActiveCodexThreadUpdate,
): ConnectedCodexSession {
  if (input.threadId === null) {
    return {
      ...input.currentSession,
      activeThreadId: null,
      activeThreadCwd: null,
    };
  }

  return {
    ...input.currentSession,
    activeThreadId: input.threadId,
    activeThreadCwd:
      input.cwd ??
      (input.currentSession.activeThreadId === input.threadId
        ? input.currentSession.activeThreadCwd
        : null),
  };
}

export function resolveCodexProviderThreadIdAfterThreadEstablishment(input: {
  providerThreadId: string | null | undefined;
  startedNewAfterMissingTarget: boolean;
}): string | null {
  return input.startedNewAfterMissingTarget ? null : (input.providerThreadId ?? null);
}

export function shouldRecordEstablishedThreadAsOriginal(input: {
  startedNewAfterMissingTarget: boolean;
}): boolean {
  return input.startedNewAfterMissingTarget;
}

export function useCodexSessionConnection(input: {
  connectionGenerationRef: RefObject<number>;
  ensureCurrentGeneration: (generation: number) => void;
  handleChatNotificationReceived: (notification: CodexJsonRpcNotification) => void;
  onTurnCompleted: () => void;
  onServerRequestNotification: (notification: CodexJsonRpcNotification) => void;
  onServerRequestReceived: (request: CodexJsonRpcServerRequest) => void;
  refreshThreadCollections: (input?: {
    rpcClient?: CodexJsonRpcClient;
    generation?: number;
    originalThreadId?: string;
  }) => Promise<CodexThreadCollectionsRefreshResult>;
  recordStartedThreadAsOriginalAfterEmptyScan: (input: {
    generation: number;
    threadId: string;
  }) => void;
  recordThreadAsOriginal: (input: { generation: number; threadId: string }) => void;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
  sessionClientRef: RefObject<AgentStreamClient | null>;
  sessionEventUnsubscribersRef: RefObject<(() => void)[]>;
  lifecycleErrorMessage: string | null;
  setLifecycleErrorMessage: (message: string | null) => void;
  threadIdRef: RefObject<string | null>;
}): CodexSessionConnectionStateResult {
  const [step, setStep] = useState<StartSessionStep>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedCodexSession | null>(null);
  const [sessionConnectionState, setSessionConnectionState] = useState<
    "detached" | "connecting" | "connected" | "recovering"
  >("detached");
  const [recoverableDisconnect, setRecoverableDisconnect] = useState<{
    id: number;
    isGatewayServiceRestart: boolean;
    message: string;
    targetThreadId: string | null;
    recoveryStrategy: "reconnect_transport" | "reopen_stream";
  } | null>(null);
  const [agentConnectionState, setAgentConnectionState] =
    useState<CodexSessionConnectionState>("idle");
  const [agentConnectionError, setAgentConnectionError] = useState<string | null>(null);
  const nextRecoverableDisconnectIdRef = useRef(0);
  const lastConnectedSessionRef = useRef<ConnectedCodexSession | null>(null);
  const reconnectTargetThreadIdRef = useRef<string | null>(null);

  const updateActiveThread = useCallback(
    (activeThreadInput: ActiveCodexThreadUpdate): void => {
      input.threadIdRef.current = activeThreadInput.threadId;
      reconnectTargetThreadIdRef.current = activeThreadInput.threadId;
      setSessionSnapshot((currentSession) => {
        if (currentSession === null) {
          return currentSession;
        }

        return updateConnectedCodexSessionActiveThread({
          currentSession,
          ...activeThreadInput,
        });
      });
    },
    [input.threadIdRef],
  );

  const teardownConnection = useCallback((): void => {
    for (const unsubscribe of input.sessionEventUnsubscribersRef.current) {
      unsubscribe();
    }
    input.sessionEventUnsubscribersRef.current = [];
    input.rpcClientRef.current?.dispose();
    input.rpcClientRef.current = null;
    input.sessionClientRef.current?.disconnect();
    input.sessionClientRef.current = null;
  }, [input.rpcClientRef, input.sessionClientRef, input.sessionEventUnsubscribersRef]);

  const detachSessionConnection = useCallback((): void => {
    input.connectionGenerationRef.current += 1;
    teardownConnection();
    setRecoverableDisconnect(null);
    reconnectTargetThreadIdRef.current = null;
    setStep("idle");
    setSessionConnectionState("detached");
    setAgentConnectionState("idle");
    setAgentConnectionError(null);
    input.setLifecycleErrorMessage(null);
  }, [input.connectionGenerationRef, input.setLifecycleErrorMessage, teardownConnection]);

  const disconnectSession = useCallback((): void => {
    input.connectionGenerationRef.current += 1;
    teardownConnection();
    setSessionSnapshot(null);
    setRecoverableDisconnect(null);
    lastConnectedSessionRef.current = null;
    input.threadIdRef.current = null;
    reconnectTargetThreadIdRef.current = null;
    setStep("idle");
    setSessionConnectionState("detached");
    input.setLifecycleErrorMessage(null);
    setAgentConnectionState("idle");
    setAgentConnectionError(null);
  }, [
    input.connectionGenerationRef,
    input.setLifecycleErrorMessage,
    input.threadIdRef,
    teardownConnection,
  ]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const attachProtocolListeners = useCallback(
    (listenerInput: {
      generation: number;
      rpcClient: CodexJsonRpcClient;
      sessionClient: AgentStreamClient;
    }): void => {
      input.sessionClientRef.current = listenerInput.sessionClient;
      input.rpcClientRef.current = listenerInput.rpcClient;

      input.sessionEventUnsubscribersRef.current = [
        listenerInput.sessionClient.onEvent((event) => {
          if (input.connectionGenerationRef.current !== listenerInput.generation) {
            return;
          }

          if (event.type === "connection_state_changed") {
            setAgentConnectionState(event.state);
            setAgentConnectionError(event.errorMessage);
            const connectionStateTransition = resolveCodexConnectionStateTransition({
              hasConnectedSession:
                lastConnectedSessionRef.current !== null || input.threadIdRef.current !== null,
              isGatewayServiceRestart: event.gatewayServiceRestart !== undefined,
              state: event.state,
              errorMessage: event.errorMessage ?? null,
            });
            if (connectionStateTransition.shouldDisconnectSession) {
              const targetThreadId = reconnectTargetThreadIdRef.current;
              input.connectionGenerationRef.current += 1;
              teardownConnection();
              setSessionConnectionState("recovering");
              if (
                connectionStateTransition.recoverableDisconnectMessage !== null &&
                connectionStateTransition.recoverableDisconnectStrategy !== null
              ) {
                const recoverableDisconnectId = nextRecoverableDisconnectIdRef.current + 1;
                nextRecoverableDisconnectIdRef.current = recoverableDisconnectId;
                setRecoverableDisconnect({
                  id: recoverableDisconnectId,
                  isGatewayServiceRestart: connectionStateTransition.isGatewayServiceRestart,
                  message: connectionStateTransition.recoverableDisconnectMessage,
                  targetThreadId,
                  recoveryStrategy: connectionStateTransition.recoverableDisconnectStrategy,
                });
              } else {
                setRecoverableDisconnect(null);
                setSessionSnapshot(null);
                lastConnectedSessionRef.current = null;
                input.threadIdRef.current = null;
                setSessionConnectionState("detached");
              }
              setStep("idle");
              setAgentConnectionState("idle");
              setAgentConnectionError(null);
              input.setLifecycleErrorMessage(connectionStateTransition.lifecycleErrorMessage);
            }
            return;
          }

          if (event.type === "stream_reset") {
            const targetThreadId = reconnectTargetThreadIdRef.current;
            const hasConnectedSession =
              lastConnectedSessionRef.current !== null || targetThreadId !== null;
            if (!hasConnectedSession) {
              return;
            }

            // Keep the existing websocket transport alive and let the dashboard recover by
            // reopening the logical agent stream once sandbox readiness catches up.
            const recoverableDisconnectId = nextRecoverableDisconnectIdRef.current + 1;
            nextRecoverableDisconnectIdRef.current = recoverableDisconnectId;
            setSessionConnectionState("recovering");
            setRecoverableDisconnect({
              id: recoverableDisconnectId,
              isGatewayServiceRestart: false,
              message: `Sandbox session stream reset (${event.resetInfo.code}): ${event.resetInfo.message}`,
              targetThreadId,
              recoveryStrategy: resolveCodexStreamResetRecoveryStrategy({
                code: event.resetInfo.code,
              }),
            });
            setStep("idle");
            setAgentConnectionState("connected_socket");
            setAgentConnectionError(null);
            input.setLifecycleErrorMessage(null);
            return;
          }

          if (event.type === "notification") {
            input.onServerRequestNotification(event.notification);
            input.handleChatNotificationReceived(event.notification);
            if (event.notification.method === "turn/completed") {
              input.onTurnCompleted();
              void input
                .refreshThreadCollections({ generation: listenerInput.generation })
                .catch((error: unknown) => {
                  if (isStaleConnectionAttemptError(error)) {
                    return;
                  }

                  input.setLifecycleErrorMessage(
                    error instanceof Error
                      ? error.message
                      : "Could not refresh thread collections.",
                  );
                });
            }
            return;
          }

          if (event.type === "server_request") {
            input.onServerRequestReceived(event.request);
          }
        }),
      ];
    },
    [
      input.connectionGenerationRef,
      input.handleChatNotificationReceived,
      input.onServerRequestNotification,
      input.onServerRequestReceived,
      input.onTurnCompleted,
      input.refreshThreadCollections,
      input.rpcClientRef,
      input.sessionClientRef,
      input.sessionEventUnsubscribersRef,
      input.threadIdRef,
      teardownConnection,
    ],
  );

  const connectSessionMutation = useMutation({
    mutationFn: async (connectInput: ConnectCodexSessionInput) => {
      const generation = input.connectionGenerationRef.current + 1;
      input.connectionGenerationRef.current = generation;
      teardownConnection();
      setSessionSnapshot(null);
      setRecoverableDisconnect(null);
      reconnectTargetThreadIdRef.current = connectInput.targetThreadId;
      setSessionConnectionState("connecting");
      input.setLifecycleErrorMessage(null);
      setStep("securing");

      let transportConnection;
      try {
        transportConnection = await input.ensureTransportConnected({
          sandboxInstanceId: connectInput.sandboxInstanceId,
        });
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeCodexSessionStepError("Connecting shared sandbox transport", error);
      }
      const sessionClient = new AgentStreamClientConstructor({
        transport: transportConnection.transport,
      });
      const rpcClient = new CodexJsonRpcClientConstructor(sessionClient);
      attachProtocolListeners({
        generation,
        rpcClient,
        sessionClient,
      });

      setStep("connecting");
      try {
        await sessionClient.connect();
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeCodexSessionStepError("Connecting to sandbox agent channel", error);
      }

      try {
        await rpcClient.initialize();
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        sessionClient.disconnect();
        throw describeCodexSessionStepError("Initializing Codex app server", error);
      }

      const threadCollections = await input.refreshThreadCollections({
        generation,
        ...(connectInput.providerThreadId === undefined || connectInput.providerThreadId === null
          ? {}
          : { originalThreadId: connectInput.providerThreadId }),
        rpcClient,
      });

      const establishedThread = await establishInitialCodexThread({
        ...(connectInput.targetThreadId === null && connectInput.initialCwd !== undefined
          ? { initialCwd: connectInput.initialCwd }
          : {}),
        rpcClient,
        targetThreadId: connectInput.targetThreadId,
        availableThreads: threadCollections.availableThreads,
        loadedThreadIds: threadCollections.loadedThreadIds,
        ...(connectInput.targetThreadId === null ||
        connectInput.missingTargetThreadAction === undefined
          ? {}
          : { missingTargetThreadAction: connectInput.missingTargetThreadAction }),
        ...(connectInput.selectionPolicy === undefined
          ? {}
          : { selectionPolicy: connectInput.selectionPolicy }),
        generation,
        sandboxInstanceId: connectInput.sandboxInstanceId,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
      });
      reconnectTargetThreadIdRef.current = establishedThread.resolvedThreadId;
      if (
        shouldRecordEstablishedThreadAsOriginal({
          startedNewAfterMissingTarget: establishedThread.startedNewAfterMissingTarget,
        })
      ) {
        input.recordThreadAsOriginal({
          generation,
          threadId: establishedThread.threadId,
        });
      }
      if (
        threadCollections.originalThreadId === null &&
        establishedThread.resolvedThreadId === null
      ) {
        input.recordStartedThreadAsOriginalAfterEmptyScan({
          generation,
          threadId: establishedThread.threadId,
        });
      }

      return {
        ...establishedThread,
        providerThreadId: resolveCodexProviderThreadIdAfterThreadEstablishment({
          providerThreadId: connectInput.providerThreadId,
          startedNewAfterMissingTarget: establishedThread.startedNewAfterMissingTarget,
        }),
      };
    },
    onSuccess: (result) => {
      if (input.connectionGenerationRef.current !== result.generation) {
        return;
      }

      updateActiveThread({
        threadId: result.threadId,
        cwd: result.cwd,
      });
      const nextConnectedSession = createConnectedCodexSession({
        sandboxInstanceId: result.sandboxInstanceId,
        connectedAtIso: new Date().toISOString(),
        providerThreadId: result.providerThreadId,
        activeThreadId: result.threadId,
        activeThreadCwd: result.cwd,
      });
      lastConnectedSessionRef.current = nextConnectedSession;
      setSessionSnapshot(nextConnectedSession);
      setRecoverableDisconnect(null);
      setSessionConnectionState("connected");
      setAgentConnectionState("ready");
      setAgentConnectionError(null);
      setStep("connected");
      input.setLifecycleErrorMessage(null);
    },
    onError: (error) => {
      if (isStaleConnectionAttemptError(error)) {
        return;
      }

      disconnectSession();
      setStep("idle");
      input.setLifecycleErrorMessage(
        getCodexSessionErrorMessage(error, "Could not establish sandbox session."),
      );
    },
  });

  const recoverSessionMutation = useMutation({
    mutationFn: async (recoverInput: {
      targetThreadId: string | null;
      sandboxInstanceId: string;
    }) => {
      const generation = input.connectionGenerationRef.current;
      const sessionClient = input.sessionClientRef.current;
      const rpcClient = input.rpcClientRef.current;
      const previousConnectedSession = lastConnectedSessionRef.current;

      if (sessionClient === null || rpcClient === null || previousConnectedSession === null) {
        throw new Error("Codex session recovery requires an existing sandbox transport.");
      }

      input.setLifecycleErrorMessage(null);
      setStep("connecting");
      setSessionConnectionState("recovering");
      reconnectTargetThreadIdRef.current = recoverInput.targetThreadId;

      try {
        // Recovery on stream reset reuses the existing websocket transport. The only
        // thing that needs to be rebuilt is the logical agent stream and its JSON-RPC
        // initialization handshake.
        await sessionClient.openAgentStream();
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeCodexSessionStepError("Reopening sandbox agent channel", error);
      }

      try {
        await rpcClient.initialize();
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeCodexSessionStepError("Reinitializing Codex app server", error);
      }

      const threadCollections = await input.refreshThreadCollections({
        generation,
        ...(previousConnectedSession.providerThreadId === null
          ? {}
          : { originalThreadId: previousConnectedSession.providerThreadId }),
        rpcClient,
      });
      const recoveredThread = await establishCodexThread({
        rpcClient,
        targetThreadId: recoverInput.targetThreadId,
        availableThreads: threadCollections.availableThreads,
        loadedThreadIds: threadCollections.loadedThreadIds,
        missingTargetThreadAction: "start_new",
        generation,
        sandboxInstanceId: recoverInput.sandboxInstanceId,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
      });
      reconnectTargetThreadIdRef.current = recoveredThread.resolvedThreadId;
      if (
        shouldRecordEstablishedThreadAsOriginal({
          startedNewAfterMissingTarget: recoveredThread.startedNewAfterMissingTarget,
        })
      ) {
        input.recordThreadAsOriginal({
          generation,
          threadId: recoveredThread.threadId,
        });
      }

      return {
        previousConnectedSession,
        recoveredThread,
      };
    },
    onSuccess: (result) => {
      if (input.connectionGenerationRef.current !== result.recoveredThread.generation) {
        return;
      }

      updateActiveThread({
        threadId: result.recoveredThread.threadId,
        cwd: result.recoveredThread.cwd,
      });
      const nextConnectedSession = {
        ...result.previousConnectedSession,
        connectedAtIso: new Date().toISOString(),
        providerThreadId: resolveCodexProviderThreadIdAfterThreadEstablishment({
          providerThreadId: result.previousConnectedSession.providerThreadId,
          startedNewAfterMissingTarget: result.recoveredThread.startedNewAfterMissingTarget,
        }),
        activeThreadId: result.recoveredThread.threadId,
        activeThreadCwd: result.recoveredThread.cwd,
      };
      lastConnectedSessionRef.current = nextConnectedSession;
      setSessionSnapshot(nextConnectedSession);
      setRecoverableDisconnect(null);
      setSessionConnectionState("connected");
      setAgentConnectionState("ready");
      setAgentConnectionError(null);
      setStep("connected");
      input.setLifecycleErrorMessage(null);
    },
    onError: (error) => {
      if (isStaleConnectionAttemptError(error)) {
        return;
      }

      setStep("idle");
      setAgentConnectionError(
        getCodexSessionErrorMessage(error, "Could not restore sandbox session."),
      );
    },
  });

  const connectSession = useCallback(
    (connectInput: ConnectCodexSessionInput) => {
      connectSessionMutation.mutate(connectInput);
    },
    [connectSessionMutation],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetThreadId: string | null }) => {
      recoverSessionMutation.mutate(recoverInput);
    },
    [recoverSessionMutation],
  );

  const clearLifecycleErrorMessage = useCallback(() => {
    input.setLifecycleErrorMessage(null);
  }, [input.setLifecycleErrorMessage]);

  const reportLifecycleErrorMessage = useCallback(
    (message: string) => {
      input.setLifecycleErrorMessage(message);
    },
    [input.setLifecycleErrorMessage],
  );

  const lifecycle = useMemo<CodexSessionConnectionLifecycleState>(
    () => ({
      step,
      lifecycleErrorMessage: input.lifecycleErrorMessage,
      sessionSnapshot,
      sessionConnectionState,
      recoverableDisconnect,
      agentConnectionState,
      agentConnectionError,
      isStartingSession: connectSessionMutation.isPending || recoverSessionMutation.isPending,
      connectSession,
      recoverSession,
      detachSessionConnection,
      disconnectSession,
      clearLifecycleErrorMessage,
      reportLifecycleErrorMessage,
    }),
    [
      agentConnectionError,
      agentConnectionState,
      clearLifecycleErrorMessage,
      connectSession,
      connectSessionMutation.isPending,
      detachSessionConnection,
      recoverSession,
      recoverSessionMutation.isPending,
      recoverableDisconnect,
      disconnectSession,
      reportLifecycleErrorMessage,
      input.lifecycleErrorMessage,
      step,
      sessionSnapshot,
      sessionConnectionState,
    ],
  );

  return {
    lifecycle,
    updateActiveThread,
  };
}
