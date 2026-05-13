import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  createOpenCodeSessionClient,
  type OpenCodeEvent,
  type OpenCodeEventSubscription,
  type OpenCodeProviderSummary,
  type OpenCodePermissionResponseInput,
  type OpenCodePromptPartInput,
  type OpenCodeSessionClient,
  type OpenCodeSessionSummary,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import type { SessionBootstrapResult } from "../../codex/session-state/session-bootstrap/index.js";
import {
  createInitialOpenCodeChatState,
  reduceOpenCodeChatState,
  type OpenCodeChatAction,
  type OpenCodeChatState,
} from "./opencode-chat-state.js";

export type ConnectedOpenCodeSession = {
  activeDirectory: string | null;
  activeSessionId: string;
  connectedAtIso: string;
  sandboxInstanceId: string;
};

export type OpenCodeSessionSelection =
  | {
      kind: "create";
    }
  | {
      kind: "resume";
      sessionId: string;
    };

export type OpenCodePromptModelSelection = {
  modelID: string;
  providerID: string;
};

export type OpenCodeSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    sandboxInstanceId: string;
    targetSessionId?: string | null;
    targetThreadId?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetThreadId: string | null }) => void;
  recoverableDisconnect: null;
  refreshModelCatalog: (input: { directory?: string | null; force?: boolean }) => Promise<void>;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedOpenCodeSession | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type UseOpenCodeSessionStateResult = {
  bootstrap: SessionBootstrapResult;
  modelCatalogDirectory: string | null;
  chat: {
    abortSession: () => Promise<void>;
    canInterruptTurn: boolean;
    chatState: OpenCodeChatState;
    hydrateChatFromSession: () => Promise<void>;
    hydrateChatFromSessionOrThrow: () => Promise<void>;
    isHydratingChat: boolean;
    isInterruptingTurn: boolean;
    isRespondingToPermission: boolean;
    isStartingTurn: boolean;
    respondToPermission: (
      input: Omit<OpenCodePermissionResponseInput, "sessionId">,
    ) => Promise<void>;
    sendPrompt: (input: {
      directory?: string;
      model?: OpenCodePromptModelSelection;
      submittedAttachments?: readonly OpenCodePromptPartInput[];
      submittedPrompt: string;
    }) => Promise<void>;
  };
  lifecycle: OpenCodeSessionLifecycleState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

const EmptyOpenCodeComposerConfig = {
  model: null,
  modelReasoningEffort: null,
};

function normalizeOpenCodeCatalogDirectory(directory: string | null | undefined): string | null {
  return directory === undefined || directory === null ? null : directory;
}

export function resolveOpenCodeSessionSelection(input: {
  listedSessions: readonly OpenCodeSessionSummary[];
  targetSessionId: string | null;
}): OpenCodeSessionSelection {
  if (input.targetSessionId !== null) {
    return {
      kind: "resume",
      sessionId: input.targetSessionId,
    };
  }

  const [mostRecentSession] = input.listedSessions;
  if (mostRecentSession === undefined) {
    return {
      kind: "create",
    };
  }

  return {
    kind: "resume",
    sessionId: mostRecentSession.id,
  };
}

export function parseOpenCodePromptModelSelection(model: string): OpenCodePromptModelSelection {
  const [providerID, ...modelIdParts] = model.split("/");
  const modelID = modelIdParts.join("/");
  if (providerID === undefined || providerID.trim().length === 0 || modelID.trim().length === 0) {
    throw new Error("OpenCode model selection must use provider/model format.");
  }

  return {
    providerID,
    modelID,
  };
}

function resolveOpenCodeModelInputModalities(
  model: OpenCodeProviderSummary["models"][string],
): readonly string[] {
  const modalities: string[] = [];
  if (model.capabilities.input.text) {
    modalities.push("text");
  }
  if (model.capabilities.input.audio) {
    modalities.push("audio");
  }
  if (model.capabilities.input.image) {
    modalities.push("image");
  }
  if (model.capabilities.input.video) {
    modalities.push("video");
  }
  if (model.capabilities.input.pdf) {
    modalities.push("pdf");
  }
  return modalities;
}

export function mapOpenCodeProvidersToComposerModels(input: {
  defaultModelByProvider: Record<string, string>;
  providers: readonly OpenCodeProviderSummary[];
}): readonly CodexModelSummary[] {
  return input.providers.flatMap((provider) =>
    Object.entries(provider.models)
      .sort(([leftModelId], [rightModelId]) => leftModelId.localeCompare(rightModelId))
      .map(([modelId, model]) => ({
        id: `${provider.id}/${modelId}`,
        model: `${provider.id}/${modelId}`,
        displayName: `${provider.name} / ${model.name}`,
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: resolveOpenCodeModelInputModalities(model),
        supportsPersonality: false,
        isDefault: input.defaultModelByProvider[provider.id] === modelId,
      })),
  );
}

async function hydrateConnectedOpenCodeChat(input: {
  client: OpenCodeSessionClient;
  directory?: string;
  dispatchChatAction: Dispatch<OpenCodeChatAction>;
  sessionId: string;
}): Promise<void> {
  const messages = await input.client.listMessages({
    sessionId: input.sessionId,
  });
  const pendingPermissions = await input.client.listPermissions({
    ...(input.directory === undefined ? {} : { directory: input.directory }),
  });
  input.dispatchChatAction({
    type: "hydrate_messages",
    sessionId: input.sessionId,
    messages,
    pendingPermissions,
  });
}

export function useOpenCodeSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UseOpenCodeSessionStateResult {
  const ensureTransportConnected = input.ensureTransportConnected;
  const clientRef = useRef<OpenCodeSessionClient | null>(null);
  const eventSubscriptionRef = useRef<OpenCodeEventSubscription | null>(null);
  const generationRef = useRef(0);
  const modelCatalogGenerationRef = useRef(0);
  const modelCatalogStateRef = useRef<{
    directory: string | null;
    phase: SessionBootstrapResult["phase"];
  }>({
    directory: null,
    phase: { status: "unavailable" },
  });
  const [step, setStep] = useState<OpenCodeSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedOpenCodeSession | null>(null);
  const [sessionConnectionState, setSessionConnectionState] =
    useState<OpenCodeSessionLifecycleState["sessionConnectionState"]>("detached");
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<readonly CodexModelSummary[]>([]);
  const [modelCatalogDirectory, setModelCatalogDirectory] = useState<string | null>(null);
  const [bootstrapPhase, setBootstrapPhase] = useState<SessionBootstrapResult["phase"]>({
    status: "unavailable",
  });
  const [chatState, dispatchChatAction] = useReducer(
    reduceOpenCodeChatState,
    undefined,
    createInitialOpenCodeChatState,
  );
  const [isHydratingChat, setIsHydratingChat] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);
  const [isRespondingToPermission, setIsRespondingToPermission] = useState(false);

  const clearLifecycleErrorMessage = useCallback((): void => {
    setLifecycleErrorMessage(null);
  }, []);

  const clearSessionErrorMessage = useCallback((): void => {
    setSessionErrorMessage(null);
  }, []);

  const reportSessionErrorMessage = useCallback((message: string): void => {
    setSessionErrorMessage(message);
  }, []);

  useEffect(() => {
    modelCatalogStateRef.current = {
      directory: modelCatalogDirectory,
      phase: bootstrapPhase,
    };
  }, [bootstrapPhase, modelCatalogDirectory]);

  const clearEventSubscription = useCallback((): void => {
    const subscription = eventSubscriptionRef.current;
    eventSubscriptionRef.current = null;
    if (subscription !== null) {
      void subscription.close();
    }
  }, []);

  const resetModelCatalog = useCallback((phase: SessionBootstrapResult["phase"]): void => {
    modelCatalogGenerationRef.current += 1;
    modelCatalogStateRef.current = {
      directory: null,
      phase,
    };
    setAvailableModels([]);
    setModelCatalogDirectory(null);
    setBootstrapPhase(phase);
  }, []);

  const disconnectSession = useCallback((): void => {
    generationRef.current += 1;
    clearEventSubscription();
    clientRef.current?.close();
    clientRef.current = null;
    resetModelCatalog({ status: "unavailable" });
    setSessionSnapshot(null);
    setSessionConnectionState("detached");
    setStep("idle");
  }, [clearEventSubscription, resetModelCatalog]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const hydrateChatFromSession = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      return;
    }
    setIsHydratingChat(true);
    try {
      const directory = sessionSnapshot?.activeDirectory ?? undefined;
      await hydrateConnectedOpenCodeChat({
        client,
        ...(directory === undefined ? {} : { directory }),
        dispatchChatAction,
        sessionId,
      });
      setSessionErrorMessage(null);
    } catch (error) {
      setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not hydrate OpenCode messages.",
      );
    } finally {
      setIsHydratingChat(false);
    }
  }, [sessionSnapshot?.activeDirectory, sessionSnapshot?.activeSessionId]);

  const hydrateChatFromSessionOrThrow = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      throw new Error("Connect OpenCode before hydrating messages.");
    }
    setIsHydratingChat(true);
    try {
      const directory = sessionSnapshot?.activeDirectory ?? undefined;
      await hydrateConnectedOpenCodeChat({
        client,
        ...(directory === undefined ? {} : { directory }),
        dispatchChatAction,
        sessionId,
      });
      setSessionErrorMessage(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Could not hydrate OpenCode messages.";
      setSessionErrorMessage(errorMessage);
      throw error instanceof Error ? error : new Error(errorMessage);
    } finally {
      setIsHydratingChat(false);
    }
  }, [sessionSnapshot?.activeDirectory, sessionSnapshot?.activeSessionId]);

  const refreshModelCatalog = useCallback(
    async (refreshInput: { directory?: string | null; force?: boolean }): Promise<void> => {
      const client = clientRef.current;
      if (client === null) {
        throw new Error("Connect OpenCode before refreshing model providers.");
      }

      const directory = normalizeOpenCodeCatalogDirectory(refreshInput.directory);
      const currentCatalogState = modelCatalogStateRef.current;
      if (
        refreshInput.force !== true &&
        currentCatalogState.directory === directory &&
        currentCatalogState.phase.status === "ready"
      ) {
        return;
      }
      const generation = modelCatalogGenerationRef.current + 1;
      modelCatalogGenerationRef.current = generation;
      modelCatalogStateRef.current = {
        directory,
        phase: { status: "bootstrapping" },
      };
      setAvailableModels([]);
      setModelCatalogDirectory(directory);
      setBootstrapPhase({ status: "bootstrapping" });

      try {
        const providerCatalog = await client.listConfigProviders({
          ...(directory === null ? {} : { directory }),
        });
        const composerModels = mapOpenCodeProvidersToComposerModels({
          providers: providerCatalog.providers,
          defaultModelByProvider: providerCatalog.default,
        });
        if (modelCatalogGenerationRef.current !== generation) {
          return;
        }
        modelCatalogStateRef.current = {
          directory,
          phase: { status: "ready" },
        };
        setAvailableModels(composerModels);
        setBootstrapPhase({ status: "ready" });
      } catch (error) {
        if (modelCatalogGenerationRef.current !== generation) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Could not load OpenCode model providers.";
        const failedPhase: SessionBootstrapResult["phase"] = {
          status: "failed",
          message,
        };
        modelCatalogStateRef.current = {
          directory,
          phase: failedPhase,
        };
        setAvailableModels([]);
        setBootstrapPhase(failedPhase);
        throw error;
      }
    },
    [],
  );

  const connectSession = useCallback(
    (connectInput: {
      initialCwd?: string | null;
      sandboxInstanceId: string;
      targetSessionId?: string | null;
      targetThreadId?: string | null;
    }): void => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      clearEventSubscription();
      clientRef.current?.close();
      clientRef.current = null;
      resetModelCatalog({ status: "bootstrapping" });
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
          const client = createOpenCodeSessionClient({
            transport: transportConnection.transport,
          });
          clientRef.current = client;
          await client.health();
          const targetSessionId =
            connectInput.targetSessionId ?? connectInput.targetThreadId ?? null;
          const directory = connectInput.initialCwd ?? undefined;
          await refreshModelCatalog(
            directory === undefined ? { force: true } : { directory, force: true },
          );
          const sessionSelection = resolveOpenCodeSessionSelection({
            targetSessionId,
            listedSessions:
              targetSessionId === null
                ? await client.listSessions({
                    ...(directory === undefined ? {} : { directory }),
                    limit: 1,
                  })
                : [],
          });
          const session =
            sessionSelection.kind === "create"
              ? await client.createSession({
                  ...(directory === undefined ? {} : { directory }),
                })
              : await client.getSession({
                  ...(directory === undefined ? {} : { directory }),
                  sessionId: sessionSelection.sessionId,
                });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          const eventSubscription = await client.subscribeEvents({
            onError: (error) => {
              setSessionErrorMessage(
                error instanceof Error ? error.message : "OpenCode event stream failed.",
              );
            },
          });
          if (generationRef.current !== generation) {
            await eventSubscription.close();
            client.close();
            return;
          }
          eventSubscriptionRef.current = eventSubscription;
          const bufferedEvents: OpenCodeEvent[] = [];
          let hydrationHasCompleted = false;
          void (async (): Promise<void> => {
            for await (const event of eventSubscription) {
              if (generationRef.current !== generation) {
                return;
              }
              if (!hydrationHasCompleted) {
                bufferedEvents.push(event);
                continue;
              }
              dispatchChatAction({
                type: "event_received",
                event,
              });
            }
          })();
          const messages = await client.listMessages({
            sessionId: session.id,
          });
          const pendingPermissions = await client.listPermissions({
            ...(directory === undefined ? {} : { directory }),
          });
          if (generationRef.current !== generation) {
            return;
          }
          dispatchChatAction({
            type: "hydrate_messages",
            sessionId: session.id,
            messages,
            pendingPermissions,
            bufferedEvents,
          });
          hydrationHasCompleted = true;
          setSessionSnapshot({
            activeDirectory: directory ?? null,
            activeSessionId: session.id,
            connectedAtIso: new Date().toISOString(),
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          setStep("connected");
          setSessionConnectionState("connected");
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          clearEventSubscription();
          clientRef.current?.close();
          clientRef.current = null;
          const failedPhase: SessionBootstrapResult["phase"] = {
            status: "failed",
            message: error instanceof Error ? error.message : "Could not connect OpenCode session.",
          };
          resetModelCatalog(failedPhase);
          setSessionSnapshot(null);
          setLifecycleErrorMessage(
            error instanceof Error ? error.message : "Could not connect OpenCode session.",
          );
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [clearEventSubscription, ensureTransportConnected, refreshModelCatalog, resetModelCatalog],
  );

  const sendPrompt = useCallback(
    async (promptInput: {
      directory?: string;
      model?: OpenCodePromptModelSelection;
      submittedAttachments?: readonly OpenCodePromptPartInput[];
      submittedPrompt: string;
    }): Promise<void> => {
      const client = clientRef.current;
      const sessionId = sessionSnapshot?.activeSessionId ?? null;
      if (client === null || sessionId === null) {
        throw new Error("Connect OpenCode before sending a prompt.");
      }
      const prompt = promptInput.submittedPrompt.trim();
      const submittedAttachments = promptInput.submittedAttachments ?? [];
      if (prompt.length === 0 && submittedAttachments.length === 0) {
        throw new Error("OpenCode prompt must not be empty.");
      }
      const textParts: readonly OpenCodePromptPartInput[] =
        prompt.length === 0
          ? []
          : [
              {
                type: "text",
                text: prompt,
              },
            ];
      setIsStartingTurn(true);
      try {
        await client.sendPrompt({
          sessionId,
          ...(promptInput.directory === undefined ? {} : { directory: promptInput.directory }),
          ...(promptInput.model === undefined ? {} : { model: promptInput.model }),
          parts: [...submittedAttachments, ...textParts],
        });
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not send OpenCode prompt.",
        );
        throw error;
      } finally {
        setIsStartingTurn(false);
      }
    },
    [sessionSnapshot?.activeSessionId],
  );

  const abortSession = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.abortSession({
        sessionId,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [sessionSnapshot?.activeSessionId]);

  const respondToPermission = useCallback(
    async (permissionInput: Omit<OpenCodePermissionResponseInput, "sessionId">): Promise<void> => {
      const client = clientRef.current;
      if (client === null) {
        throw new Error("Connect OpenCode before responding to a permission request.");
      }
      setIsRespondingToPermission(true);
      try {
        await client.respondToPermission(permissionInput);
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
        );
        throw error;
      } finally {
        setIsRespondingToPermission(false);
      }
    },
    [],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetThreadId: string | null }): void => {
      connectSession(recoverInput);
    },
    [connectSession],
  );

  return {
    bootstrap: {
      phase: bootstrapPhase,
      establishedSnapshot: {
        availableModels,
        configSnapshot: EmptyOpenCodeComposerConfig,
      },
    },
    modelCatalogDirectory,
    lifecycle: {
      clearLifecycleErrorMessage,
      connectSession,
      detachSessionConnection: disconnectSession,
      disconnectSession,
      isStartingSession: sessionConnectionState === "connecting",
      lifecycleErrorMessage,
      recoverSession,
      recoverableDisconnect: null,
      refreshModelCatalog,
      sessionConnectionState,
      sessionSnapshot,
      step,
    },
    chat: {
      abortSession,
      canInterruptTurn: chatState.status === "busy",
      chatState,
      hydrateChatFromSession,
      hydrateChatFromSessionOrThrow,
      isHydratingChat,
      isInterruptingTurn,
      isRespondingToPermission,
      isStartingTurn,
      respondToPermission,
      sendPrompt,
    },
    sessionMessage: {
      clearSessionErrorMessage,
      reportSessionErrorMessage,
      sessionErrorMessage,
    },
  };
}
