import {
  createPiSessionClient,
  type PiAgentMessage,
  type PiConversationSummary,
  type PiEvent,
  type PiEventSubscription,
  type PiModel,
  type PiSessionClient,
  type PiSessionState,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { systemScheduler } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import type { SessionComposerBootstrapResult } from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import { createInitialPiChatState, reducePiChatState, type PiChatState } from "./pi-chat-state.js";
import {
  buildReadyPiComposerBootstrap,
  buildUnavailablePiComposerBootstrap,
  type PiModelSelection,
} from "./pi-workbench-composer.js";

export type ConnectedPiConversation = {
  activeConversationId: string;
  activeDirectory: string | null;
  activeSessionFile: string;
  connectedAtIso: string;
  providerConversationId: string | null;
  sandboxInstanceId: string;
};

export type PiSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    providerConversationId?: string | null;
    sandboxInstanceId: string;
    targetConversationId?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: {
    sandboxInstanceId: string;
    targetConversationId: string | null;
  }) => void;
  recoverableDisconnect: null;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedPiConversation | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type PiConversationNavigatorState = {
  activeConversationDirectory: string | null;
  activeConversationId: string | null;
  activeSessionFile: string | null;
  availableConversations: readonly PiConversationSummary[];
  hasMoreAvailableConversations: boolean;
  originalConversationId: string | null;
  isStartingNewConversation: boolean;
  pendingConversationId: string | null;
  refreshConversationList: (input?: {
    directory?: string | null;
  }) => Promise<readonly PiConversationSummary[]>;
  resumeConversation: (conversationId: string, input?: { directory?: string }) => Promise<string>;
  startNewConversation: (input?: { directory?: string }) => Promise<string>;
};

export type PiConversationSelection =
  | {
      kind: "create";
    }
  | {
      kind: "resume";
      providerConversationId: string;
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
    followUpTurn: (input: { submittedPrompt: string }) => Promise<void>;
    sendPrompt: (input: { submittedPrompt: string }) => Promise<void>;
    steerTurn: (input: { submittedPrompt: string }) => Promise<void>;
  };
  modelControl: {
    setActiveModel: (selection: PiModelSelection) => Promise<PiModel>;
  };
  lifecycle: PiSessionLifecycleState;
  conversations: PiConversationNavigatorState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

export function resolvePiConversationSelection(input: {
  recentProviderConversationId: string | null;
  targetConversationId: string | null;
}): PiConversationSelection {
  if (input.targetConversationId !== null) {
    return {
      kind: "resume",
      providerConversationId: input.targetConversationId,
    };
  }

  if (input.recentProviderConversationId !== null) {
    return {
      kind: "resume",
      providerConversationId: input.recentProviderConversationId,
    };
  }

  return {
    kind: "create",
  };
}

const PiNavigatorConversationLimit = 20;
const PiPersistedConversationRefreshDelaysMs = [0, 250, 750, 1_500] as const;

type PiConversationPage = {
  conversations: readonly PiConversationSummary[];
  hasMore: boolean;
};

function waitForPiPersistedConversationRefresh(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    systemScheduler.schedule(resolve, delayMs);
  });
}

async function listPiConversationPage(input: {
  client: PiSessionClient;
  directory?: string | null;
}): Promise<PiConversationPage> {
  return input.client.listConversations({
    ...(input.directory === undefined || input.directory === null ? {} : { cwd: input.directory }),
    limit: PiNavigatorConversationLimit,
  });
}

function parsePiConversationCreatedAt(conversation: PiConversationSummary): number | null {
  if (conversation.createdAt === null) {
    return null;
  }

  const createdAt = Date.parse(conversation.createdAt);
  return Number.isNaN(createdAt) ? null : createdAt;
}

export function resolveOriginalPiConversationId(input: {
  explicitProviderConversationId: string | null;
  hasMoreSandboxConversations: boolean;
  sandboxConversations: readonly PiConversationSummary[];
}): string | null {
  if (input.explicitProviderConversationId !== null) {
    return input.explicitProviderConversationId;
  }

  if (input.hasMoreSandboxConversations) {
    return null;
  }

  let originalConversationId: string | null = null;
  let originalCreatedAt: number | null = null;
  for (const conversation of input.sandboxConversations) {
    const createdAt = parsePiConversationCreatedAt(conversation);
    if (createdAt === null) {
      continue;
    }

    if (
      originalCreatedAt === null ||
      createdAt < originalCreatedAt ||
      (createdAt === originalCreatedAt &&
        (originalConversationId === null || conversation.id < originalConversationId))
    ) {
      originalConversationId = conversation.id;
      originalCreatedAt = createdAt;
    }
  }

  return originalConversationId;
}

export function resolvePiConversationDirectory(input: {
  conversations: readonly PiConversationSummary[];
  conversationId: string;
  preferredDirectory: string | null | undefined;
}): string | null {
  if (input.preferredDirectory !== undefined && input.preferredDirectory !== null) {
    return input.preferredDirectory;
  }

  return (
    input.conversations.find((conversation) => conversation.id === input.conversationId)?.cwd ??
    null
  );
}

export function resolveListedPiConversationId(input: {
  conversations: readonly PiConversationSummary[];
  fallbackConversationId: string;
  sessionFile: string;
}): string {
  return (
    input.conversations.find((conversation) => conversation.sessionFile === input.sessionFile)
      ?.id ?? input.fallbackConversationId
  );
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

async function loadConnectedPiComposerBootstrap(input: {
  activeSessionState: PiSessionState;
  client: PiSessionClient;
  sessionFile: string;
}): Promise<{
  availableModels: readonly PiModel[];
  bootstrap: SessionComposerBootstrapResult;
}> {
  const availableModels = await input.client.getAvailableModels({
    sessionFile: input.sessionFile,
  });
  return {
    availableModels,
    bootstrap: buildReadyPiComposerBootstrap({
      activeModel: input.activeSessionState.model ?? null,
      availableModels,
    }),
  };
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
  const availablePiModelsRef = useRef<readonly PiModel[]>([]);
  const generationRef = useRef(0);
  const previousChatStatusRef = useRef<PiChatState["status"]>(null);
  const [step, setStep] = useState<PiSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedPiConversation | null>(null);
  const [sessionConnectionState, setSessionConnectionState] =
    useState<PiSessionLifecycleState["sessionConnectionState"]>("detached");
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<SessionComposerBootstrapResult>(
    buildUnavailablePiComposerBootstrap({ status: "unavailable" }),
  );
  const [chatState, dispatchChatAction] = useReducer(
    reducePiChatState,
    undefined,
    createInitialPiChatState,
  );
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isSteeringTurn, setIsSteeringTurn] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);
  const [availableConversations, setAvailableConversations] = useState<
    readonly PiConversationSummary[]
  >([]);
  const [hasMoreAvailableConversations, setHasMoreAvailableConversations] = useState(false);
  const [originalConversationId, setOriginalConversationId] = useState<string | null>(null);
  const [isStartingNewConversation, setIsStartingNewConversation] = useState(false);
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);

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
    availablePiModelsRef.current = [];
    setBootstrap(buildUnavailablePiComposerBootstrap({ status: "unavailable" }));
    setSessionSnapshot(null);
    setAvailableConversations([]);
    setHasMoreAvailableConversations(false);
    setOriginalConversationId(null);
    setIsStartingNewConversation(false);
    setPendingConversationId(null);
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

  const refreshConversationList = useCallback(
    async (refreshInput?: {
      directory?: string | null;
    }): Promise<readonly PiConversationSummary[]> => {
      const client = clientRef.current;
      if (client === null) {
        return [];
      }

      const directory =
        refreshInput !== undefined && "directory" in refreshInput
          ? (refreshInput.directory ?? null)
          : (sessionSnapshot?.activeDirectory ?? null);
      const [conversationPage, sandboxConversationPage] = await Promise.all([
        listPiConversationPage({
          client,
          directory,
        }),
        listPiConversationPage({
          client,
        }),
      ]);
      const activeSessionFile = sessionSnapshot?.activeSessionFile ?? null;
      const activeConversationId = sessionSnapshot?.activeConversationId ?? null;
      if (activeSessionFile !== null && activeConversationId !== null) {
        const listedConversationId = resolveListedPiConversationId({
          conversations: [
            ...conversationPage.conversations,
            ...sandboxConversationPage.conversations,
          ],
          fallbackConversationId: activeConversationId,
          sessionFile: activeSessionFile,
        });
        if (listedConversationId !== activeConversationId) {
          setSessionSnapshot((currentSnapshot) =>
            currentSnapshot === null ||
            currentSnapshot.activeSessionFile !== activeSessionFile ||
            currentSnapshot.activeConversationId !== activeConversationId
              ? currentSnapshot
              : {
                  ...currentSnapshot,
                  activeConversationId: listedConversationId,
                },
          );
        }
      }
      setAvailableConversations(conversationPage.conversations);
      setHasMoreAvailableConversations(conversationPage.hasMore);
      setOriginalConversationId(
        resolveOriginalPiConversationId({
          explicitProviderConversationId: sessionSnapshot?.providerConversationId ?? null,
          hasMoreSandboxConversations: sandboxConversationPage.hasMore,
          sandboxConversations: sandboxConversationPage.conversations,
        }),
      );
      return conversationPage.conversations;
    },
    [
      sessionSnapshot?.activeConversationId,
      sessionSnapshot?.activeDirectory,
      sessionSnapshot?.activeSessionFile,
      sessionSnapshot?.providerConversationId,
    ],
  );

  useEffect(() => {
    const previousStatus = previousChatStatusRef.current;
    previousChatStatusRef.current = chatState.status;

    const activeConversationId = sessionSnapshot?.activeConversationId ?? null;
    if (
      previousStatus !== "busy" ||
      chatState.status !== "idle" ||
      activeConversationId === null ||
      availableConversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      return;
    }

    const refreshGeneration = generationRef.current;
    void (async (): Promise<void> => {
      for (const delayMs of PiPersistedConversationRefreshDelaysMs) {
        if (delayMs > 0) {
          await waitForPiPersistedConversationRefresh(delayMs);
        }
        if (generationRef.current !== refreshGeneration) {
          return;
        }

        const refreshedConversations = await refreshConversationList({
          directory: sessionSnapshot?.activeDirectory ?? null,
        });
        if (
          refreshedConversations.some((conversation) => conversation.id === activeConversationId)
        ) {
          return;
        }
      }
    })();
  }, [
    availableConversations,
    chatState.status,
    refreshConversationList,
    sessionSnapshot?.activeDirectory,
    sessionSnapshot?.activeConversationId,
  ]);

  const connectSession = useCallback(
    (connectInput: {
      initialCwd?: string | null;
      providerConversationId?: string | null;
      sandboxInstanceId: string;
      targetConversationId?: string | null;
    }): void => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      clearEventSubscription();
      clientRef.current?.close();
      clientRef.current = null;
      availablePiModelsRef.current = [];
      setBootstrap(buildUnavailablePiComposerBootstrap({ status: "bootstrapping" }));
      setStep("securing");
      setSessionConnectionState("connecting");
      setLifecycleErrorMessage(null);
      setAvailableConversations([]);
      setHasMoreAvailableConversations(false);
      setOriginalConversationId(null);
      setPendingConversationId(null);
      setIsStartingNewConversation(false);

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
          const targetConversationId = connectInput.targetConversationId ?? null;
          const recentConversation =
            targetConversationId === null
              ? await client.findRecentConversation({
                  cwd: connectInput.initialCwd ?? null,
                })
              : { providerConversationId: null };
          const conversationSelection = resolvePiConversationSelection({
            targetConversationId,
            recentProviderConversationId: recentConversation.providerConversationId,
          });
          let activeConversationId: string;
          let activeSessionFile: string;
          if (conversationSelection.kind === "resume") {
            const resumedConversation = await client.resumeConversation({
              providerConversationId: conversationSelection.providerConversationId,
            });
            activeConversationId = conversationSelection.providerConversationId;
            activeSessionFile = resumedConversation.sessionFile;
          } else {
            const session = await client.createConversation({
              ...(connectInput.initialCwd === undefined || connectInput.initialCwd === null
                ? {}
                : { cwd: connectInput.initialCwd }),
            });
            activeConversationId = session.providerConversationId;
            activeSessionFile = session.sessionFile;
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
          const composerBootstrap = await loadConnectedPiComposerBootstrap({
            activeSessionState,
            client,
            sessionFile: activeSessionFile,
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          availablePiModelsRef.current = composerBootstrap.availableModels;
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
          const [conversationPage, sandboxConversationPage] = await Promise.all([
            listPiConversationPage({
              client,
              directory: connectInput.initialCwd ?? null,
            }),
            listPiConversationPage({
              client,
            }),
          ]);
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          const directory = resolvePiConversationDirectory({
            conversations: [
              ...conversationPage.conversations,
              ...sandboxConversationPage.conversations,
            ],
            conversationId: activeConversationId,
            preferredDirectory: connectInput.initialCwd,
          });
          hydrationHasCompleted = true;
          setAvailableConversations(conversationPage.conversations);
          setHasMoreAvailableConversations(conversationPage.hasMore);
          setOriginalConversationId(
            resolveOriginalPiConversationId({
              explicitProviderConversationId: connectInput.providerConversationId ?? null,
              hasMoreSandboxConversations: sandboxConversationPage.hasMore,
              sandboxConversations: sandboxConversationPage.conversations,
            }),
          );
          setSessionSnapshot({
            activeConversationId,
            activeDirectory: directory,
            activeSessionFile,
            connectedAtIso: new Date().toISOString(),
            providerConversationId: connectInput.providerConversationId ?? null,
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          setBootstrap(composerBootstrap.bootstrap);
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
          availablePiModelsRef.current = [];
          setBootstrap(buildUnavailablePiComposerBootstrap({ status: "failed", message }));
          setSessionSnapshot(null);
          setAvailableConversations([]);
          setHasMoreAvailableConversations(false);
          setOriginalConversationId(null);
          setPendingConversationId(null);
          setIsStartingNewConversation(false);
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

  const followUpTurn = useCallback(
    async (followUpInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
      if (client === null || sessionFile === null) {
        throw new Error("Connect Pi before queueing a follow-up.");
      }
      const prompt = followUpInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Pi follow-up prompt must not be empty.");
      }
      try {
        await client.followUp({
          sessionFile,
          message: prompt,
        });
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not queue Pi follow-up.",
        );
        throw error;
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

  const setActiveModel = useCallback(
    async (selection: PiModelSelection): Promise<PiModel> => {
      const client = clientRef.current;
      const sessionFile = sessionSnapshot?.activeSessionFile ?? null;
      if (client === null || sessionFile === null) {
        throw new Error("Connect Pi before changing models.");
      }
      const selectedModel = await client.setModel({
        sessionFile,
        provider: selection.provider,
        modelId: selection.modelId,
      });
      setBootstrap(
        buildReadyPiComposerBootstrap({
          activeModel: selectedModel,
          availableModels: availablePiModelsRef.current,
        }),
      );
      setSessionErrorMessage(null);
      return selectedModel;
    },
    [sessionSnapshot?.activeSessionFile],
  );

  const activateConversation = useCallback(
    async (input: {
      client: PiSessionClient;
      conversationId: string;
      directory: string | null;
      sessionFile: string;
    }) => {
      const activeSessionState = await input.client.getState({
        sessionFile: input.sessionFile,
      });
      const composerBootstrap = await loadConnectedPiComposerBootstrap({
        activeSessionState,
        client: input.client,
        sessionFile: input.sessionFile,
      });
      availablePiModelsRef.current = composerBootstrap.availableModels;
      await hydrateConnectedPiChat({
        client: input.client,
        dispatchChatAction,
        sessionFile: input.sessionFile,
        status: resolvePiChatStatusFromSessionState(activeSessionState),
      });
      setBootstrap(composerBootstrap.bootstrap);
      setSessionSnapshot((currentSnapshot) =>
        currentSnapshot === null
          ? currentSnapshot
          : {
              ...currentSnapshot,
              activeConversationId: input.conversationId,
              activeDirectory: input.directory,
              activeSessionFile: input.sessionFile,
              connectedAtIso: new Date().toISOString(),
            },
      );
      setSessionErrorMessage(null);
    },
    [],
  );

  const resumeConversation = useCallback(
    async (conversationId: string, resumeInput?: { directory?: string }): Promise<string> => {
      const client = clientRef.current;
      if (client === null) {
        throw new Error("Connect Pi before resuming a conversation.");
      }

      setPendingConversationId(conversationId);
      try {
        const resumedConversation = await client.resumeConversation({
          providerConversationId: conversationId,
        });
        const directory = resolvePiConversationDirectory({
          conversations: availableConversations,
          conversationId,
          preferredDirectory: resumeInput?.directory,
        });
        await activateConversation({
          client,
          conversationId,
          directory,
          sessionFile: resumedConversation.sessionFile,
        });
        await refreshConversationList({
          directory,
        });
        return conversationId;
      } finally {
        setPendingConversationId(null);
      }
    },
    [activateConversation, availableConversations, refreshConversationList],
  );

  const startNewConversation = useCallback(
    async (startInput?: { directory?: string }): Promise<string> => {
      const client = clientRef.current;
      if (client === null) {
        throw new Error("Connect Pi before starting a new conversation.");
      }
      const directory = resolvePiConversationDirectory({
        conversations: availableConversations,
        conversationId: sessionSnapshot?.activeConversationId ?? "",
        preferredDirectory: startInput?.directory ?? sessionSnapshot?.activeDirectory,
      });

      setIsStartingNewConversation(true);
      try {
        const createdConversation = await client.createConversation({
          ...(directory === null ? {} : { cwd: directory }),
        });
        await activateConversation({
          client,
          conversationId: createdConversation.providerConversationId,
          directory,
          sessionFile: createdConversation.sessionFile,
        });
        await refreshConversationList({
          directory,
        });
        return createdConversation.providerConversationId;
      } finally {
        setIsStartingNewConversation(false);
      }
    },
    [activateConversation, availableConversations, refreshConversationList, sessionSnapshot],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetConversationId: string | null }): void => {
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
      followUpTurn,
      sendPrompt,
      steerTurn,
    },
    modelControl: {
      setActiveModel,
    },
    conversations: {
      activeConversationDirectory: sessionSnapshot?.activeDirectory ?? null,
      activeConversationId: sessionSnapshot?.activeConversationId ?? null,
      activeSessionFile: sessionSnapshot?.activeSessionFile ?? null,
      availableConversations,
      hasMoreAvailableConversations,
      originalConversationId,
      isStartingNewConversation,
      pendingConversationId,
      refreshConversationList,
      resumeConversation,
      startNewConversation,
    },
    sessionMessage: {
      clearSessionErrorMessage,
      reportSessionErrorMessage,
      sessionErrorMessage,
    },
  };
}
