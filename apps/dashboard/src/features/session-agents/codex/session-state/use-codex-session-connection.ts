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
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";

import { mintSandboxInstanceConnectionToken } from "../../../sessions/sessions-service.js";
import {
  createConnectedCodexSession,
  establishInitialCodexThread,
} from "./codex-session-connect.js";
import {
  describeCodexSessionStepError,
  StaleConnectionAttemptError,
} from "./codex-session-errors.js";
import {
  parseThreadLifecycleEvent,
  parseThreadTokenUsageSnapshot,
  parseTurnDiffSnapshot,
  parseTurnPlanSnapshot,
} from "./codex-session-events.js";
import { resolveCodexConnectionStateTransition } from "./codex-session-lifecycle-policy.js";
import type {
  ConnectedCodexSession,
  CodexThreadLifecycleEvent,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
  StartSessionStep,
} from "./codex-session-types.js";

type CodexThreadCollectionsRefreshResult = {
  availableThreads: readonly CodexThreadSummary[];
  archivedThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
};

export type CodexSessionConnectionLifecycleState = {
  step: StartSessionStep;
  startErrorMessage: string | null;
  connectedSession: ConnectedCodexSession | null;
  agentConnectionState: CodexSessionConnectionState;
  agentConnectionError: string | null;
  isStartingSession: boolean;
  connectSession: (input: { sandboxInstanceId: string; preferredThreadId: string | null }) => void;
  disconnectSession: () => void;
  clearStartErrorMessage: () => void;
  reportStartErrorMessage: (message: string) => void;
};

export type CodexSessionConnectionStateResult = {
  lifecycle: CodexSessionConnectionLifecycleState;
  updateActiveThread: (threadId: string | null) => void;
};

export function useCodexSessionConnection(input: {
  connectionGenerationRef: MutableRefObject<number>;
  ensureCurrentGeneration: (generation: number) => void;
  handleChatNotificationReceived: (notification: CodexJsonRpcNotification) => void;
  onServerRequestNotification: (notification: CodexJsonRpcNotification) => void;
  onServerRequestReceived: (request: CodexJsonRpcServerRequest) => void;
  recordRecentNotification: (payload: unknown) => void;
  recordRecentResponse: (payload: unknown) => void;
  recordRecentServerRequest: (payload: unknown) => void;
  recordRecentUnhandledMessage: (payload: unknown) => void;
  recordThreadLifecycleEvent: (payload: CodexThreadLifecycleEvent) => void;
  recordThreadTokenUsageSnapshot: (payload: CodexThreadTokenUsageSnapshot) => void;
  recordTurnDiffSnapshot: (payload: CodexTurnDiffSnapshot) => void;
  recordTurnPlanSnapshot: (payload: CodexTurnPlanSnapshot) => void;
  refreshThreadCollections: (input?: {
    rpcClient?: CodexJsonRpcClient;
    generation?: number;
  }) => Promise<CodexThreadCollectionsRefreshResult>;
  resetSessionData: () => void;
  resetChat: () => void;
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  sessionClientRef: MutableRefObject<CodexSessionClient | null>;
  sessionEventUnsubscribersRef: MutableRefObject<(() => void)[]>;
  startErrorMessage: string | null;
  setStartErrorMessage: (message: string | null) => void;
  threadIdRef: MutableRefObject<string | null>;
}): CodexSessionConnectionStateResult {
  const [step, setStep] = useState<StartSessionStep>("idle");
  const [connectedSession, setConnectedSession] = useState<ConnectedCodexSession | null>(null);
  const [agentConnectionState, setAgentConnectionState] =
    useState<CodexSessionConnectionState>("idle");
  const [agentConnectionError, setAgentConnectionError] = useState<string | null>(null);

  const updateActiveThread = useCallback(
    (threadId: string | null): void => {
      input.threadIdRef.current = threadId;
      setConnectedSession((currentSession) => {
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

  const disconnectSession = useCallback((): void => {
    input.connectionGenerationRef.current += 1;
    teardownConnection("Disconnected from sessions page.");
    input.resetSessionData();
    setConnectedSession(null);
    setStep("idle");
    input.setStartErrorMessage(null);
    setAgentConnectionState("idle");
    setAgentConnectionError(null);
  }, [
    input.connectionGenerationRef,
    input.resetSessionData,
    input.setStartErrorMessage,
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
              state: event.state,
              errorMessage: event.errorMessage ?? null,
            });
            if (connectionStateTransition.shouldResetSession) {
              input.connectionGenerationRef.current += 1;
              teardownConnection("Disconnected from Codex session.");
              input.resetSessionData();
              setConnectedSession(null);
              setStep("idle");
              setAgentConnectionState("idle");
              setAgentConnectionError(null);
              input.setStartErrorMessage(connectionStateTransition.startErrorMessage);
            }
            return;
          }

          if (event.type === "response") {
            input.recordRecentResponse(event.response);
            return;
          }

          if (event.type === "notification") {
            const threadLifecycleEvent = parseThreadLifecycleEvent(event.notification);
            if (threadLifecycleEvent !== null) {
              input.recordThreadLifecycleEvent(threadLifecycleEvent);
            }

            const turnDiffSnapshot = parseTurnDiffSnapshot(event.notification);
            if (turnDiffSnapshot !== null) {
              input.recordTurnDiffSnapshot(turnDiffSnapshot);
            }

            const turnPlanSnapshot = parseTurnPlanSnapshot(event.notification);
            if (turnPlanSnapshot !== null) {
              input.recordTurnPlanSnapshot(turnPlanSnapshot);
            }

            const threadTokenUsageSnapshot = parseThreadTokenUsageSnapshot(event.notification);
            if (threadTokenUsageSnapshot !== null) {
              input.recordThreadTokenUsageSnapshot(threadTokenUsageSnapshot);
            }

            input.onServerRequestNotification(event.notification);
            input.handleChatNotificationReceived(event.notification);
            if (event.notification.method === "turn/completed") {
              void input
                .refreshThreadCollections({ generation: listenerInput.generation })
                .catch((error: unknown) => {
                  input.setStartErrorMessage(
                    error instanceof Error
                      ? error.message
                      : "Could not refresh thread collections.",
                  );
                });
            }
            input.recordRecentNotification(event.notification);
            return;
          }

          if (event.type === "server_request") {
            input.onServerRequestReceived(event.request);
            input.recordRecentServerRequest(event.request);
            return;
          }

          input.recordRecentUnhandledMessage(event.payload);
        }),
      ];
    },
    [
      input.connectionGenerationRef,
      input.handleChatNotificationReceived,
      input.onServerRequestNotification,
      input.onServerRequestReceived,
      input.recordRecentNotification,
      input.recordRecentResponse,
      input.recordRecentServerRequest,
      input.recordRecentUnhandledMessage,
      input.recordThreadLifecycleEvent,
      input.recordThreadTokenUsageSnapshot,
      input.recordTurnDiffSnapshot,
      input.recordTurnPlanSnapshot,
      input.refreshThreadCollections,
      input.resetSessionData,
      input.rpcClientRef,
      input.sessionClientRef,
      input.sessionEventUnsubscribersRef,
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
      input.resetSessionData();
      setConnectedSession(null);
      input.setStartErrorMessage(null);
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
      input.resetChat();
      setConnectedSession(
        createConnectedCodexSession({
          sandboxInstanceId: result.sandboxInstanceId,
          connectedAtIso: new Date().toISOString(),
          mintedConnection: result.mintedConnection,
          threadId: result.threadId,
        }),
      );
      setAgentConnectionState("ready");
      setAgentConnectionError(null);
      setStep("connected");
      input.setStartErrorMessage(null);
    },
    onError: (error) => {
      if (error instanceof StaleConnectionAttemptError) {
        return;
      }

      disconnectSession();
      setStep("idle");
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not establish sandbox session.",
      );
    },
  });

  const connectSession = useCallback(
    (connectInput: { sandboxInstanceId: string; preferredThreadId: string | null }) => {
      connectSessionMutation.mutate(connectInput);
    },
    [connectSessionMutation],
  );

  const clearStartErrorMessage = useCallback(() => {
    input.setStartErrorMessage(null);
  }, [input.setStartErrorMessage]);

  const reportStartErrorMessage = useCallback(
    (message: string) => {
      input.setStartErrorMessage(message);
    },
    [input.setStartErrorMessage],
  );

  const lifecycle = useMemo<CodexSessionConnectionLifecycleState>(
    () => ({
      step,
      startErrorMessage: input.startErrorMessage,
      connectedSession,
      agentConnectionState,
      agentConnectionError,
      isStartingSession: connectSessionMutation.isPending,
      connectSession,
      disconnectSession,
      clearStartErrorMessage,
      reportStartErrorMessage,
    }),
    [
      agentConnectionError,
      agentConnectionState,
      clearStartErrorMessage,
      connectSession,
      connectSessionMutation.isPending,
      connectedSession,
      disconnectSession,
      reportStartErrorMessage,
      input.startErrorMessage,
      step,
    ],
  );

  return {
    lifecycle,
    updateActiveThread,
  };
}
