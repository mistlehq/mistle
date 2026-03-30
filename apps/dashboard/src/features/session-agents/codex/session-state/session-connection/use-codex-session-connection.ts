import type {
  CodexJsonRpcClient,
  CodexJsonRpcNotification,
  CodexJsonRpcServerRequest,
  CodexSessionClient,
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import {
  createBrowserCodexSessionRuntime,
  CodexJsonRpcClient as CodexJsonRpcClientConstructor,
  CodexSessionClient as CodexSessionClientConstructor,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { mintSandboxInstanceConnectionToken } from "../../../../sessions/sessions-service.js";
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
import { resolveCodexConnectionStateTransition } from "./codex-session-lifecycle-policy.js";

type CodexThreadCollectionsRefreshResult = {
  availableThreads: readonly CodexThreadSummary[];
  archivedThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
};

export type CodexSessionConnectionLifecycleState = {
  step: StartSessionStep;
  lifecycleErrorMessage: string | null;
  sessionSnapshot: ConnectedCodexSession | null;
  transportState: "detached" | "connecting" | "connected" | "recovering";
  recoverableDisconnect: {
    id: number;
    message: string;
    preferredThreadId: string | null;
    recoveryStrategy: "reconnect_transport" | "reopen_stream";
  } | null;
  agentConnectionState: CodexSessionConnectionState;
  agentConnectionError: string | null;
  isStartingSession: boolean;
  connectSession: (input: { sandboxInstanceId: string; preferredThreadId: string | null }) => void;
  recoverSession: (input: { sandboxInstanceId: string; preferredThreadId: string | null }) => void;
  detachSessionTransport: () => void;
  disconnectSession: () => void;
  clearLifecycleErrorMessage: () => void;
  reportLifecycleErrorMessage: (message: string) => void;
};

export type CodexSessionConnectionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  updateActiveThread: (threadId: string | null) => void;
};

export function useCodexSessionConnection(input: {
  connectionGenerationRef: RefObject<number>;
  ensureCurrentGeneration: (generation: number) => void;
  handleChatNotificationReceived: (notification: CodexJsonRpcNotification) => void;
  onServerRequestNotification: (notification: CodexJsonRpcNotification) => void;
  onServerRequestReceived: (request: CodexJsonRpcServerRequest) => void;
  refreshThreadCollections: (input?: {
    rpcClient?: CodexJsonRpcClient;
    generation?: number;
  }) => Promise<CodexThreadCollectionsRefreshResult>;
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
  sessionClientRef: RefObject<CodexSessionClient | null>;
  sessionEventUnsubscribersRef: RefObject<(() => void)[]>;
  lifecycleErrorMessage: string | null;
  setLifecycleErrorMessage: (message: string | null) => void;
  threadIdRef: RefObject<string | null>;
}): CodexSessionConnectionStateResult {
  const [step, setStep] = useState<StartSessionStep>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedCodexSession | null>(null);
  const [transportState, setTransportState] = useState<
    "detached" | "connecting" | "connected" | "recovering"
  >("detached");
  const [recoverableDisconnect, setRecoverableDisconnect] = useState<{
    id: number;
    message: string;
    preferredThreadId: string | null;
    recoveryStrategy: "reconnect_transport" | "reopen_stream";
  } | null>(null);
  const [agentConnectionState, setAgentConnectionState] =
    useState<CodexSessionConnectionState>("idle");
  const [agentConnectionError, setAgentConnectionError] = useState<string | null>(null);
  const nextRecoverableDisconnectIdRef = useRef(0);
  const lastConnectedSessionRef = useRef<ConnectedCodexSession | null>(null);

  const updateActiveThread = useCallback(
    (threadId: string | null): void => {
      input.threadIdRef.current = threadId;
      setSessionSnapshot((currentSession) => {
        if (currentSession === null) {
          return currentSession;
        }

        return {
          ...currentSession,
          threadId,
        };
      });
    },
    [input.threadIdRef],
  );

  const teardownConnection = useCallback(
    (reason: string): void => {
      for (const unsubscribe of input.sessionEventUnsubscribersRef.current) {
        unsubscribe();
      }
      input.sessionEventUnsubscribersRef.current = [];
      input.rpcClientRef.current?.dispose();
      input.rpcClientRef.current = null;
      input.sessionClientRef.current?.disconnect(1000, reason);
      input.sessionClientRef.current = null;
    },
    [input.rpcClientRef, input.sessionClientRef, input.sessionEventUnsubscribersRef],
  );

  const detachSessionTransport = useCallback((): void => {
    input.connectionGenerationRef.current += 1;
    teardownConnection("Detached from Codex session transport.");
    setRecoverableDisconnect(null);
    setStep("idle");
    setTransportState("detached");
    setAgentConnectionState("idle");
    setAgentConnectionError(null);
    input.setLifecycleErrorMessage(null);
  }, [input.connectionGenerationRef, input.setLifecycleErrorMessage, teardownConnection]);

  const disconnectSession = useCallback((): void => {
    input.connectionGenerationRef.current += 1;
    teardownConnection("Disconnected from sessions page.");
    setSessionSnapshot(null);
    setRecoverableDisconnect(null);
    lastConnectedSessionRef.current = null;
    input.threadIdRef.current = null;
    setStep("idle");
    setTransportState("detached");
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
      sessionClient: CodexSessionClient;
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
              state: event.state,
              errorMessage: event.errorMessage ?? null,
            });
            if (connectionStateTransition.shouldDisconnectSession) {
              const preferredThreadId = input.threadIdRef.current;
              input.connectionGenerationRef.current += 1;
              teardownConnection("Disconnected from Codex session.");
              setTransportState("recovering");
              if (connectionStateTransition.recoverableDisconnectMessage !== null) {
                const recoverableDisconnectId = nextRecoverableDisconnectIdRef.current + 1;
                nextRecoverableDisconnectIdRef.current = recoverableDisconnectId;
                setRecoverableDisconnect({
                  id: recoverableDisconnectId,
                  message: connectionStateTransition.recoverableDisconnectMessage,
                  preferredThreadId,
                  recoveryStrategy: "reconnect_transport",
                });
              } else {
                setRecoverableDisconnect(null);
                setSessionSnapshot(null);
                lastConnectedSessionRef.current = null;
                input.threadIdRef.current = null;
                setTransportState("detached");
              }
              setStep("idle");
              setAgentConnectionState("idle");
              setAgentConnectionError(null);
              input.setLifecycleErrorMessage(connectionStateTransition.lifecycleErrorMessage);
            }
            return;
          }

          if (event.type === "stream_reset") {
            const preferredThreadId = input.threadIdRef.current;
            const hasConnectedSession =
              lastConnectedSessionRef.current !== null || preferredThreadId !== null;
            if (!hasConnectedSession) {
              return;
            }

            // Keep the existing websocket transport alive and let the dashboard recover by
            // reopening the logical agent stream once sandbox readiness catches up.
            const recoverableDisconnectId = nextRecoverableDisconnectIdRef.current + 1;
            nextRecoverableDisconnectIdRef.current = recoverableDisconnectId;
            setTransportState("recovering");
            setRecoverableDisconnect({
              id: recoverableDisconnectId,
              message: `Sandbox session stream reset (${event.resetInfo.code}): ${event.resetInfo.message}`,
              preferredThreadId,
              recoveryStrategy: "reopen_stream",
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
      input.refreshThreadCollections,
      input.rpcClientRef,
      input.sessionClientRef,
      input.sessionEventUnsubscribersRef,
      input.threadIdRef,
      teardownConnection,
    ],
  );

  const connectSessionMutation = useMutation({
    mutationFn: async (connectInput: {
      preferredThreadId: string | null;
      sandboxInstanceId: string;
    }) => {
      const generation = input.connectionGenerationRef.current + 1;
      input.connectionGenerationRef.current = generation;
      teardownConnection("Superseded by a new Codex session.");
      setSessionSnapshot(null);
      setRecoverableDisconnect(null);
      setTransportState("connecting");
      input.setLifecycleErrorMessage(null);
      setStep("securing");

      let mintedConnection;
      try {
        mintedConnection = await mintSandboxInstanceConnectionToken({
          instanceId: connectInput.sandboxInstanceId,
        });
        input.ensureCurrentGeneration(generation);
      } catch (error) {
        throw describeCodexSessionStepError("Minting sandbox connection token", error);
      }

      const sessionClient = new CodexSessionClientConstructor({
        connectionUrl: mintedConnection.connectionUrl,
        runtime: createBrowserCodexSessionRuntime(),
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
        sessionClient.disconnect(1000, "Initialization failed.");
        throw describeCodexSessionStepError("Initializing Codex app server", error);
      }

      const threadCollections = await input.refreshThreadCollections({
        generation,
        rpcClient,
      });

      return await establishInitialCodexThread({
        rpcClient,
        preferredThreadId: connectInput.preferredThreadId,
        availableThreads: threadCollections.availableThreads,
        loadedThreadIds: threadCollections.loadedThreadIds,
        generation,
        sandboxInstanceId: connectInput.sandboxInstanceId,
        mintedConnection,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
      });
    },
    onSuccess: (result) => {
      if (input.connectionGenerationRef.current !== result.generation) {
        return;
      }

      updateActiveThread(result.threadId);
      const nextConnectedSession = createConnectedCodexSession({
        sandboxInstanceId: result.sandboxInstanceId,
        connectedAtIso: new Date().toISOString(),
        mintedConnection: result.mintedConnection,
        threadId: result.threadId,
      });
      lastConnectedSessionRef.current = nextConnectedSession;
      setSessionSnapshot(nextConnectedSession);
      setRecoverableDisconnect(null);
      setTransportState("connected");
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
      preferredThreadId: string | null;
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
      setTransportState("recovering");

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
        rpcClient,
      });
      const recoveredThread = await establishCodexThread({
        rpcClient,
        preferredThreadId: recoverInput.preferredThreadId,
        availableThreads: threadCollections.availableThreads,
        loadedThreadIds: threadCollections.loadedThreadIds,
        generation,
        sandboxInstanceId: recoverInput.sandboxInstanceId,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
      });

      return {
        previousConnectedSession,
        recoveredThread,
      };
    },
    onSuccess: (result) => {
      if (input.connectionGenerationRef.current !== result.recoveredThread.generation) {
        return;
      }

      updateActiveThread(result.recoveredThread.threadId);
      const nextConnectedSession = {
        ...result.previousConnectedSession,
        connectedAtIso: new Date().toISOString(),
        threadId: result.recoveredThread.threadId,
      };
      lastConnectedSessionRef.current = nextConnectedSession;
      setSessionSnapshot(nextConnectedSession);
      setRecoverableDisconnect(null);
      setTransportState("connected");
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
    (connectInput: { sandboxInstanceId: string; preferredThreadId: string | null }) => {
      connectSessionMutation.mutate(connectInput);
    },
    [connectSessionMutation],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; preferredThreadId: string | null }) => {
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
      transportState,
      recoverableDisconnect,
      agentConnectionState,
      agentConnectionError,
      isStartingSession: connectSessionMutation.isPending || recoverSessionMutation.isPending,
      connectSession,
      recoverSession,
      detachSessionTransport,
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
      detachSessionTransport,
      recoverSession,
      recoverSessionMutation.isPending,
      recoverableDisconnect,
      disconnectSession,
      reportLifecycleErrorMessage,
      input.lifecycleErrorMessage,
      step,
      sessionSnapshot,
      transportState,
    ],
  );

  return {
    lifecycle,
    updateActiveThread,
  };
}
