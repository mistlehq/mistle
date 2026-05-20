import {
  createPiSessionClient,
  type PiAgentMessage,
  type PiEvent,
  type PiEventSubscription,
  type PiSessionClient,
  type PiSessionState,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import type {
  SessionComposerBootstrapResult,
  SessionComposerBootstrapPhase,
} from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import { createInitialPiChatState, reducePiChatState, type PiChatState } from "./pi-chat-state.js";

export type ConnectedPiConversation = {
  activeDirectory: string | null;
  activeSessionFile: string;
  connectedAtIso: string;
  sandboxInstanceId: string;
};

export type PiSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    sandboxInstanceId: string;
    targetSessionFile?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetSessionFile: string | null }) => void;
  recoverableDisconnect: null;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedPiConversation | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type PiConversationSelection =
  | {
      kind: "create";
    }
  | {
      kind: "resume";
      sessionFile: string;
    };

export type UsePiSessionStateResult = {
  bootstrap: SessionComposerBootstrapResult;
  chat: {
    abortConversation: () => Promise<void>;
    canInterruptTurn: boolean;
    canSteerTurn: boolean;
    chatState: PiChatState;
    confirmChatRestoredAfterReconnect: () => Promise<void>;
    isInterruptingTurn: boolean;
    isStartingTurn: boolean;
    isSteeringTurn: boolean;
    sendPrompt: (input: { submittedPrompt: string }) => Promise<void>;
    steerTurn: (input: { submittedPrompt: string }) => Promise<void>;
  };
  lifecycle: PiSessionLifecycleState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

const EmptyPiComposerConfig = {
  model: null,
  modelReasoningEffort: null,
};

const ReadyPiBootstrap: SessionComposerBootstrapResult = {
  phase: { status: "ready" },
  composerCapabilities: [],
  establishedSnapshot: {
    availableModels: [],
    configSnapshot: EmptyPiComposerConfig,
  },
};

export function resolvePiConversationSelection(input: {
  recentProviderConversationId: string | null;
  targetSessionFile: string | null;
}): PiConversationSelection {
  if (input.targetSessionFile !== null) {
    return {
      kind: "resume",
      sessionFile: input.targetSessionFile,
    };
  }

  if (input.recentProviderConversationId !== null) {
    return {
      kind: "resume",
      sessionFile: input.recentProviderConversationId,
    };
  }

  return {
    kind: "create",
  };
}

function createUnavailablePiBootstrap(
  phase: SessionComposerBootstrapPhase,
): SessionComposerBootstrapResult {
  return {
    phase,
    composerCapabilities: [],
    establishedSnapshot: {
      availableModels: [],
      configSnapshot: EmptyPiComposerConfig,
    },
  };
}

async function hydrateConnectedPiChat(input: {
  bufferedEvents?: readonly PiEvent[];
  client: PiSessionClient;
  dispatchChatAction: Dispatch<Parameters<typeof reducePiChatState>[1]>;
  sessionFile: string;
  shouldApply?: () => boolean;
  status?: "busy" | "idle";
}): Promise<readonly PiAgentMessage[]> {
  const messages = await input.client.getMessages({
    sessionFile: input.sessionFile,
  });
  if (input.shouldApply !== undefined && !input.shouldApply()) {
    return messages;
  }
  input.dispatchChatAction({
    type: "hydrate_messages",
    ...(input.bufferedEvents === undefined ? {} : { bufferedEvents: input.bufferedEvents }),
    sessionFile: input.sessionFile,
    messages,
    ...(input.status === undefined ? {} : { status: input.status }),
  });
  return messages;
}

function resolvePiChatStatusFromSessionState(sessionState: PiSessionState): "busy" | "idle" {
  return sessionState.isStreaming ||
    sessionState.isCompacting ||
    sessionState.pendingMessageCount > 0
    ? "busy"
    : "idle";
}

export function usePiSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UsePiSessionStateResult {
  const ensureTransportConnected = input.ensureTransportConnected;
  const clientRef = useRef<PiSessionClient | null>(null);
  const eventSubscriptionRef = useRef<PiEventSubscription | null>(null);
  const generationRef = useRef(0);
  const [step, setStep] = useState<PiSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedPiConversation | null>(null);
  const [sessionConnectionState, setSessionConnectionState] =
    useState<PiSessionLifecycleState["sessionConnectionState"]>("detached");
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<SessionComposerBootstrapResult>(
    createUnavailablePiBootstrap({ status: "unavailable" }),
  );
  const [chatState, dispatchChatAction] = useReducer(
    reducePiChatState,
    undefined,
    createInitialPiChatState,
  );
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isSteeringTurn, setIsSteeringTurn] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);

  const clearLifecycleErrorMessage = useCallback((): void => {
    setLifecycleErrorMessage(null);
  }, []);

  const clearSessionErrorMessage = useCallback((): void => {
    setSessionErrorMessage(null);
  }, []);

  const reportSessionErrorMessage = useCallback((message: string): void => {
    setSessionErrorMessage(message);
  }, []);

  const clearEventSubscription = useCallback((): void => {
    const subscription = eventSubscriptionRef.current;
    eventSubscriptionRef.current = null;
    subscription?.close();
  }, []);

  const disconnectSession = useCallback((): void => {
    generationRef.current += 1;
    clearEventSubscription();
    clientRef.current?.close();
    clientRef.current = null;
    setBootstrap(createUnavailablePiBootstrap({ status: "unavailable" }));
    setSessionSnapshot(null);
    setSessionConnectionState("detached");
    setStep("idle");
  }, [clearEventSubscription]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const confirmChatRestoredAfterReconnect = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
    if (client === null || sessionFile === null) {
      throw new Error("Connect Pi before restoring chat.");
    }
    setSessionErrorMessage(null);
  }, [sessionSnapshot?.activeSessionFile]);

  const connectSession = useCallback(
    (connectInput: {
      initialCwd?: string | null;
      sandboxInstanceId: string;
      targetSessionFile?: string | null;
    }): void => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      clearEventSubscription();
      clientRef.current?.close();
      clientRef.current = null;
      setBootstrap(createUnavailablePiBootstrap({ status: "bootstrapping" }));
      setStep("securing");
      setSessionConnectionState("connecting");
      setLifecycleErrorMessage(null);

      void (async (): Promise<void> => {
        try {
          const transportConnection = await ensureTransportConnected({
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          if (generationRef.current !== generation) {
            return;
          }
          setStep("connecting");
          const client = createPiSessionClient({
            transport: transportConnection.transport,
          });
          clientRef.current = client;
          await client.connect();
          const targetSessionFile = connectInput.targetSessionFile ?? null;
          const recentConversation =
            targetSessionFile === null
              ? await client.findRecentConversation({
                  cwd: connectInput.initialCwd ?? null,
                })
              : { providerConversationId: null };
          const conversationSelection = resolvePiConversationSelection({
            targetSessionFile,
            recentProviderConversationId: recentConversation.providerConversationId,
          });
          let activeSessionFile: string;
          if (conversationSelection.kind === "resume") {
            await client.resumeConversation({
              sessionFile: conversationSelection.sessionFile,
            });
            activeSessionFile = conversationSelection.sessionFile;
          } else {
            const session = await client.createConversation({
              ...(connectInput.initialCwd === undefined || connectInput.initialCwd === null
                ? {}
                : { cwd: connectInput.initialCwd }),
            });
            activeSessionFile = session.providerConversationId;
          }
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          const bufferedEvents: PiEvent[] = [];
          let hydrationHasCompleted = false;
          eventSubscriptionRef.current = client.subscribeEvents({
            onEvent: (event) => {
              if (!hydrationHasCompleted) {
                bufferedEvents.push(event);
                return;
              }
              dispatchChatAction({
                type: "event_received",
                event,
              });
            },
          });
          const activeSessionState = await client.getState({
            sessionFile: activeSessionFile,
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          await hydrateConnectedPiChat({
            bufferedEvents,
            client,
            dispatchChatAction,
            sessionFile: activeSessionFile,
            shouldApply: () => generationRef.current === generation,
            status: resolvePiChatStatusFromSessionState(activeSessionState),
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          hydrationHasCompleted = true;
          setSessionSnapshot({
            activeDirectory: connectInput.initialCwd ?? null,
            activeSessionFile,
            connectedAtIso: new Date().toISOString(),
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          setBootstrap(ReadyPiBootstrap);
          setStep("connected");
          setSessionConnectionState("connected");
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          clearEventSubscription();
          clientRef.current?.close();
          clientRef.current = null;
          const message =
            error instanceof Error ? error.message : "Could not connect Pi conversation.";
          setBootstrap(createUnavailablePiBootstrap({ status: "failed", message }));
          setSessionSnapshot(null);
          setLifecycleErrorMessage(message);
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [clearEventSubscription, ensureTransportConnected],
  );

  const sendPrompt = useCallback(
    async (promptInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
      if (client === null || sessionFile === null) {
        throw new Error("Connect Pi before sending a prompt.");
      }
      const prompt = promptInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Pi prompt must not be empty.");
      }
      dispatchChatAction({
        type: "prompt_submitted",
        sessionFile,
        submittedPrompt: prompt,
      });
      setIsStartingTurn(true);
      try {
        await client.prompt({
          sessionFile,
          message: prompt,
        });
        setSessionErrorMessage(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not send Pi prompt.";
        dispatchChatAction({
          type: "turn_failed",
          errorMessage: message,
        });
        setSessionErrorMessage(message);
        throw error;
      } finally {
        setIsStartingTurn(false);
      }
    },
    [sessionSnapshot?.activeSessionFile],
  );

  const steerTurn = useCallback(
    async (steerInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
      if (client === null || sessionFile === null) {
        throw new Error("Connect Pi before steering.");
      }
      const prompt = steerInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Pi steering prompt must not be empty.");
      }
      setIsSteeringTurn(true);
      try {
        await client.steer({
          sessionFile,
          message: prompt,
        });
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(error instanceof Error ? error.message : "Could not steer Pi.");
        throw error;
      } finally {
        setIsSteeringTurn(false);
      }
    },
    [sessionSnapshot?.activeSessionFile],
  );

  const abortConversation = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
    if (client === null || sessionFile === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.abort({
        sessionFile,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [sessionSnapshot?.activeSessionFile]);

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetSessionFile: string | null }): void => {
      connectSession(recoverInput);
    },
    [connectSession],
  );

  return {
    bootstrap,
    lifecycle: {
      clearLifecycleErrorMessage,
      connectSession,
      detachSessionConnection: disconnectSession,
      disconnectSession,
      isStartingSession: sessionConnectionState === "connecting",
      lifecycleErrorMessage,
      recoverSession,
      recoverableDisconnect: null,
      sessionConnectionState,
      sessionSnapshot,
      step,
    },
    chat: {
      abortConversation,
      canInterruptTurn: chatState.status === "busy",
      canSteerTurn: chatState.status === "busy",
      chatState,
      confirmChatRestoredAfterReconnect,
      isInterruptingTurn,
      isStartingTurn,
      isSteeringTurn,
      sendPrompt,
      steerTurn,
    },
    sessionMessage: {
      clearSessionErrorMessage,
      reportSessionErrorMessage,
      sessionErrorMessage,
    },
  };
}
