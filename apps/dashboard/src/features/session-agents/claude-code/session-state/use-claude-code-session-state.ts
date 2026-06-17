import {
  createClaudeCodeSessionClient,
  type ClaudeCodeSessionConfig,
  type ClaudeCodeSessionClient,
  type ClaudeCodeSessionReadResult,
  type ClaudeCodeSessionSummary,
} from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { systemSleeper } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { SessionComposerBootstrapResult } from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import {
  createInitialClaudeCodeChatState,
  reduceClaudeCodeChatState,
  type ClaudeCodeChatState,
} from "./claude-code-chat-state.js";
import {
  formatClaudeCodeContextUsage,
  type ClaudeCodeContextUsageViewModel,
} from "./claude-code-context-usage.js";
import { buildReadyClaudeCodeComposerBootstrap } from "./claude-code-workbench-composer.js";

export type ConnectedClaudeCodeSession = {
  activeDirectory: string | null;
  activeSessionId: string;
  connectedAtIso: string;
  providerSessionId: string | null;
  sandboxInstanceId: string;
};

export type ClaudeCodeSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    providerSessionId?: string | null;
    sandboxInstanceId: string;
    targetSessionId?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetSessionId: string | null }) => void;
  recoverableDisconnect: null;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedClaudeCodeSession | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type ClaudeCodeSessionNavigatorState = {
  activeSessionDirectory: string | null;
  activeSessionId: string | null;
  activeSessionStartedAt: number | null;
  availableSessions: readonly ClaudeCodeSessionNavigatorSummary[];
  hasMoreAvailableSessions: boolean;
  isStartingNewSession: boolean;
  originalSessionId: string | null;
  pendingSessionId: string | null;
  refreshSessionList: (input?: {
    directory?: string | null;
  }) => Promise<readonly ClaudeCodeSessionNavigatorSummary[]>;
  resumeSession: (sessionId: string, input?: { directory?: string | null }) => Promise<string>;
  startNewSession: (input?: { directory?: string }) => Promise<string>;
};

export type ClaudeCodeSessionNavigatorSummary = {
  createdAt: number | null;
  cwd: string;
  id: string;
  title: string;
  updatedAt: number | null;
};

export type UseClaudeCodeSessionStateResult = {
  bootstrap: SessionComposerBootstrapResult;
  chat: {
    canInterruptTurn: boolean;
    canSteerTurn: boolean;
    chatState: ClaudeCodeChatState;
    hydrateChatFromSessionOrThrow: () => Promise<void>;
    interruptQuery: () => Promise<void>;
    isInterruptingTurn: boolean;
    isStartingTurn: boolean;
    isSteeringTurn: boolean;
    sendPrompt: (input: { submittedPrompt: string }) => Promise<void>;
    steerTurn: (input: { submittedPrompt: string }) => Promise<void>;
  };
  lifecycle: ClaudeCodeSessionLifecycleState;
  contextUsage: ClaudeCodeContextUsageViewModel | null;
  modelControl: {
    refreshModelCatalog: () => Promise<void>;
    setSessionConfig: (input: {
      model: string;
      modelReasoningEffort: string | null;
    }) => Promise<void>;
  };
  sessions: ClaudeCodeSessionNavigatorState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

const ClaudeCodeTurnPollIntervalMs = 1_000;
const ClaudeCodeNavigatorSessionLimit = 20;
const EmptyClaudeCodeSessionConfig: ClaudeCodeSessionConfig = {
  availableCommands: [],
  availableModels: [],
  model: null,
  modelReasoningEffort: null,
};

function buildUnavailableClaudeCodeBootstrap(
  phase: SessionComposerBootstrapResult["phase"],
): SessionComposerBootstrapResult {
  return {
    ...buildReadyClaudeCodeComposerBootstrap(EmptyClaudeCodeSessionConfig),
    phase,
  };
}

type ClaudeCodeSessionSelection =
  | {
      kind: "create";
    }
  | {
      kind: "resume";
      sessionId: string;
    };

type ClaudeCodeSessionPage = {
  hasMore: boolean;
  sessions: readonly ClaudeCodeSessionNavigatorSummary[];
};

async function listClaudeCodeSessionPage(input: {
  client: ClaudeCodeSessionClient;
  directory?: string | null;
}): Promise<ClaudeCodeSessionPage> {
  const sessions = await input.client.listSessions({
    ...(input.directory === undefined || input.directory === null ? {} : { cwd: input.directory }),
    limit: ClaudeCodeNavigatorSessionLimit + 1,
  });

  return {
    hasMore: sessions.length > ClaudeCodeNavigatorSessionLimit,
    sessions: sessions.slice(0, ClaudeCodeNavigatorSessionLimit).map(mapClaudeCodeSessionSummary),
  };
}

export function resolveClaudeCodeSessionSelection(input: {
  listedSessions: readonly ClaudeCodeSessionNavigatorSummary[];
  targetSessionId: string | null;
}): ClaudeCodeSessionSelection {
  if (input.targetSessionId !== null) {
    return {
      kind: "resume",
      sessionId: input.targetSessionId,
    };
  }

  const [mostRecentSession] = input.listedSessions;
  if (mostRecentSession !== undefined) {
    return {
      kind: "resume",
      sessionId: mostRecentSession.id,
    };
  }

  return { kind: "create" };
}

export function resolveOriginalClaudeCodeSessionId(input: {
  explicitProviderSessionId: string | null;
  hasMoreSandboxSessions: boolean;
  sandboxSessions: readonly ClaudeCodeSessionNavigatorSummary[];
}): string | null {
  if (input.explicitProviderSessionId !== null) {
    return input.explicitProviderSessionId;
  }

  if (input.hasMoreSandboxSessions) {
    return null;
  }

  let originalSessionId: string | null = null;
  let originalCreatedAt: number | null = null;
  for (const session of input.sandboxSessions) {
    const createdAt = session.createdAt;
    if (createdAt === null) {
      continue;
    }

    if (
      originalCreatedAt === null ||
      createdAt < originalCreatedAt ||
      (createdAt === originalCreatedAt &&
        (originalSessionId === null || session.id < originalSessionId))
    ) {
      originalSessionId = session.id;
      originalCreatedAt = createdAt;
    }
  }

  return originalSessionId;
}

export function resolveClaudeCodeResumeDirectory(input: {
  activeDirectory: string | null;
  resumeInput?: { directory?: string | null };
}): string | null {
  if (input.resumeInput === undefined) {
    return input.activeDirectory;
  }

  if (
    input.resumeInput.directory === undefined ||
    input.resumeInput.directory === null ||
    input.resumeInput.directory.length === 0
  ) {
    return null;
  }

  return input.resumeInput.directory;
}

function mapClaudeCodeSessionSummary(
  session: ClaudeCodeSessionSummary,
): ClaudeCodeSessionNavigatorSummary {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd ?? "",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function createActiveClaudeCodeSessionSummary(
  session: ConnectedClaudeCodeSession | null,
): ClaudeCodeSessionNavigatorSummary | null {
  if (session === null) {
    return null;
  }

  const startedAt = Date.parse(session.connectedAtIso);
  const timestamp = Number.isNaN(startedAt) ? null : startedAt;
  return {
    id: session.activeSessionId,
    title: "Claude Code session",
    cwd: session.activeDirectory ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function readClaudeCodeSessionWithRuntimeCatalogs(input: {
  client: ClaudeCodeSessionClient;
  sessionId: string;
}): Promise<Awaited<ReturnType<ClaudeCodeSessionClient["readSession"]>>> {
  const session = await input.client.readSession({
    sessionId: input.sessionId,
  });
  const modelConfig = await input.client.refreshModelCatalog({
    sessionId: input.sessionId,
  });
  const commandConfig = await input.client.refreshCommandCatalog({
    sessionId: input.sessionId,
  });
  return {
    session: {
      ...session.session,
      config: {
        availableCommands: commandConfig.availableCommands,
        availableModels: modelConfig.availableModels,
        model: modelConfig.model,
        modelReasoningEffort: modelConfig.modelReasoningEffort,
      },
    },
  };
}

export function useClaudeCodeSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UseClaudeCodeSessionStateResult {
  const ensureTransportConnected = input.ensureTransportConnected;
  const clientRef = useRef<ClaudeCodeSessionClient | null>(null);
  const generationRef = useRef(0);
  const sessionSnapshotRef = useRef<ConnectedClaudeCodeSession | null>(null);
  const [step, setStep] = useState<ClaudeCodeSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedClaudeCodeSession | null>(null);
  const [sessionConnectionState, setSessionConnectionState] =
    useState<ClaudeCodeSessionLifecycleState["sessionConnectionState"]>("detached");
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [chatState, dispatchChatAction] = useReducer(
    reduceClaudeCodeChatState,
    undefined,
    createInitialClaudeCodeChatState,
  );
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isSteeringTurn, setIsSteeringTurn] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);
  const [availableSessions, setAvailableSessions] = useState<
    readonly ClaudeCodeSessionNavigatorSummary[]
  >([]);
  const [hasMoreAvailableSessions, setHasMoreAvailableSessions] = useState(false);
  const [originalSessionId, setOriginalSessionId] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const sessionNavigationRequestSequenceRef = useRef(0);
  const [bootstrap, setBootstrap] = useState<SessionComposerBootstrapResult>(
    buildUnavailableClaudeCodeBootstrap({ status: "unavailable" }),
  );
  const [activeContextUsage, setActiveContextUsage] =
    useState<ClaudeCodeContextUsageViewModel | null>(null);

  const updateSessionSnapshot = useCallback((snapshot: ConnectedClaudeCodeSession | null): void => {
    sessionSnapshotRef.current = snapshot;
    setSessionSnapshot(snapshot);
  }, []);

  const isCurrentSessionResponse = useCallback(
    (response: { client: ClaudeCodeSessionClient; sessionId: string }): boolean =>
      clientRef.current === response.client &&
      sessionSnapshotRef.current?.activeSessionId === response.sessionId,
    [],
  );

  const clearLifecycleErrorMessage = useCallback((): void => {
    setLifecycleErrorMessage(null);
  }, []);

  const clearSessionErrorMessage = useCallback((): void => {
    setSessionErrorMessage(null);
  }, []);

  const reportSessionErrorMessage = useCallback((message: string): void => {
    setSessionErrorMessage(message);
  }, []);

  const applyHydratedSession = useCallback(
    (session: ClaudeCodeSessionReadResult["session"]): void => {
      dispatchChatAction({
        type: "hydrate_session",
        session,
      });
      setBootstrap(buildReadyClaudeCodeComposerBootstrap(session.config));
      setActiveContextUsage(formatClaudeCodeContextUsage(session.contextUsage));
    },
    [],
  );

  const disconnectSession = useCallback((): void => {
    generationRef.current += 1;
    sessionNavigationRequestSequenceRef.current += 1;
    clientRef.current?.close();
    clientRef.current = null;
    setBootstrap(buildUnavailableClaudeCodeBootstrap({ status: "unavailable" }));
    setActiveContextUsage(null);
    updateSessionSnapshot(null);
    setAvailableSessions([]);
    setHasMoreAvailableSessions(false);
    setOriginalSessionId(null);
    setPendingSessionId(null);
    setIsStartingNewSession(false);
    setSessionConnectionState("detached");
    setStep("idle");
  }, [updateSessionSnapshot]);

  // Synchronizes the external Claude Code sandbox transport lifecycle with React unmount cleanup.
  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const hydrateChatFromSessionOrThrow = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      throw new Error("Connect Claude Code before hydrating messages.");
    }

    const session = await readClaudeCodeSessionWithRuntimeCatalogs({ client, sessionId });
    applyHydratedSession(session.session);
    setSessionErrorMessage(null);
  }, [applyHydratedSession, sessionSnapshot?.activeSessionId]);

  const pollSessionUntilIdle = useCallback(
    async (input: { client: ClaudeCodeSessionClient; generation: number; sessionId: string }) => {
      while (generationRef.current === input.generation) {
        const session = await input.client.readSession({
          sessionId: input.sessionId,
        });
        if (
          generationRef.current !== input.generation ||
          sessionSnapshotRef.current?.activeSessionId !== input.sessionId
        ) {
          return;
        }
        applyHydratedSession(session.session);
        if (session.session.status.type !== "active") {
          return;
        }
        await systemSleeper.sleep(ClaudeCodeTurnPollIntervalMs);
      }
    },
    [applyHydratedSession],
  );

  const refreshSessionList = useCallback(
    async (refreshInput?: {
      directory?: string | null;
    }): Promise<readonly ClaudeCodeSessionNavigatorSummary[]> => {
      const client = clientRef.current;
      if (client === null) {
        return [];
      }
      const sessionPage = await listClaudeCodeSessionPage({
        client,
        directory: refreshInput?.directory ?? sessionSnapshotRef.current?.activeDirectory ?? null,
      });
      setAvailableSessions(sessionPage.sessions);
      setHasMoreAvailableSessions(sessionPage.hasMore);
      return sessionPage.sessions;
    },
    [],
  );

  const connectSession = useCallback(
    (connectInput: {
      initialCwd?: string | null;
      providerSessionId?: string | null;
      sandboxInstanceId: string;
      targetSessionId?: string | null;
    }): void => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      sessionNavigationRequestSequenceRef.current += 1;
      clientRef.current?.close();
      clientRef.current = null;
      setBootstrap(buildUnavailableClaudeCodeBootstrap({ status: "bootstrapping" }));
      setActiveContextUsage(null);
      setStep("securing");
      setSessionConnectionState("connecting");
      setLifecycleErrorMessage(null);
      setPendingSessionId(null);
      setIsStartingNewSession(false);

      void (async (): Promise<void> => {
        try {
          const transportConnection = await ensureTransportConnected({
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          if (generationRef.current !== generation) {
            return;
          }
          setStep("connecting");
          const client = createClaudeCodeSessionClient({
            transport: transportConnection.transport,
          });
          clientRef.current = client;
          await client.connect();
          const directory = connectInput.initialCwd ?? null;
          const targetSessionId =
            connectInput.targetSessionId ?? connectInput.providerSessionId ?? null;
          const sessionPage = await listClaudeCodeSessionPage({
            client,
            directory,
          });
          const sandboxSessionPage =
            directory === null
              ? sessionPage
              : await listClaudeCodeSessionPage({
                  client,
                });
          const sessionSelection = resolveClaudeCodeSessionSelection({
            listedSessions: targetSessionId === null ? sessionPage.sessions : [],
            targetSessionId,
          });
          let activeSessionId: string;
          if (sessionSelection.kind === "create") {
            const createdSession = await client.createSession({
              ...(connectInput.initialCwd === undefined ? {} : { cwd: connectInput.initialCwd }),
            });
            activeSessionId = createdSession.sessionId;
          } else {
            const listedSession = sessionPage.sessions.find(
              (candidateSession) => candidateSession.id === sessionSelection.sessionId,
            );
            await client.resumeSession({
              cwd:
                listedSession === undefined
                  ? directory
                  : resolveClaudeCodeResumeDirectory({
                      activeDirectory: directory,
                      resumeInput: { directory: listedSession.cwd },
                    }),
              sessionId: sessionSelection.sessionId,
            });
            activeSessionId = sessionSelection.sessionId;
          }
          const session = await readClaudeCodeSessionWithRuntimeCatalogs({
            client,
            sessionId: activeSessionId,
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          applyHydratedSession(session.session);
          setAvailableSessions(sessionPage.sessions);
          setHasMoreAvailableSessions(sessionPage.hasMore);
          setOriginalSessionId(
            resolveOriginalClaudeCodeSessionId({
              explicitProviderSessionId: connectInput.providerSessionId ?? null,
              hasMoreSandboxSessions: sandboxSessionPage.hasMore,
              sandboxSessions: sandboxSessionPage.sessions,
            }),
          );
          updateSessionSnapshot({
            activeDirectory: session.session.cwd ?? connectInput.initialCwd ?? null,
            activeSessionId,
            connectedAtIso: new Date().toISOString(),
            providerSessionId: connectInput.providerSessionId ?? null,
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          setStep("connected");
          setSessionConnectionState("connected");
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          clientRef.current?.close();
          clientRef.current = null;
          const message =
            error instanceof Error ? error.message : "Could not connect Claude Code session.";
          setBootstrap(buildUnavailableClaudeCodeBootstrap({ status: "failed", message }));
          setActiveContextUsage(null);
          updateSessionSnapshot(null);
          setPendingSessionId(null);
          setIsStartingNewSession(false);
          setLifecycleErrorMessage(message);
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [applyHydratedSession, ensureTransportConnected, updateSessionSnapshot],
  );

  const sendPrompt = useCallback(
    async (promptInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionId = sessionSnapshot?.activeSessionId ?? null;
      if (client === null || sessionId === null) {
        throw new Error("Connect Claude Code before sending a prompt.");
      }
      const prompt = promptInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Claude Code prompt must not be empty.");
      }
      const generation = generationRef.current;
      setIsStartingTurn(true);
      try {
        const query = await client.startQuery({
          sessionId,
          inputText: prompt,
        });
        dispatchChatAction({
          type: "prompt_submitted",
          queryId: query.queryId,
          sessionId,
          submittedPrompt: prompt,
        });
        setSessionErrorMessage(null);
        await pollSessionUntilIdle({
          client,
          generation,
          sessionId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not send Claude Code prompt.";
        dispatchChatAction({
          type: "query_failed",
          errorMessage: message,
        });
        setSessionErrorMessage(message);
        throw error;
      } finally {
        setIsStartingTurn(false);
      }
    },
    [pollSessionUntilIdle, sessionSnapshot?.activeSessionId],
  );

  const steerTurn = useCallback(
    async (steerInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionId = sessionSnapshot?.activeSessionId ?? null;
      if (client === null || sessionId === null) {
        throw new Error("Connect Claude Code before steering.");
      }
      const prompt = steerInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Claude Code steering prompt must not be empty.");
      }
      const generation = generationRef.current;
      setIsSteeringTurn(true);
      try {
        await client.steerQuery({
          sessionId,
          inputText: prompt,
        });
        setSessionErrorMessage(null);
        await pollSessionUntilIdle({
          client,
          generation,
          sessionId,
        });
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not steer Claude Code.",
        );
        throw error;
      } finally {
        setIsSteeringTurn(false);
      }
    },
    [pollSessionUntilIdle, sessionSnapshot?.activeSessionId],
  );

  const interruptQuery = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    const queryId = chatState.pendingQueryId;
    if (client === null || sessionId === null || queryId === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.interruptQuery({
        queryId,
        sessionId,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [chatState.pendingQueryId, sessionSnapshot?.activeSessionId]);

  const setSessionConfig = useCallback(
    async (configInput: { model: string; modelReasoningEffort: string | null }): Promise<void> => {
      const client = clientRef.current;
      const sessionId = sessionSnapshot?.activeSessionId ?? null;
      if (client === null || sessionId === null) {
        throw new Error("Connect Claude Code before changing model settings.");
      }

      const config = await client.setSessionConfig({
        sessionId,
        model: configInput.model,
        modelReasoningEffort: configInput.modelReasoningEffort,
      });
      if (!isCurrentSessionResponse({ client, sessionId })) {
        return;
      }
      setBootstrap(buildReadyClaudeCodeComposerBootstrap(config));
      setActiveContextUsage(null);
      setSessionErrorMessage(null);
    },
    [isCurrentSessionResponse, sessionSnapshot?.activeSessionId],
  );

  const refreshModelCatalog = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      throw new Error("Connect Claude Code before loading models.");
    }

    const config = await client.refreshModelCatalog({
      refresh: true,
      sessionId,
    });
    if (!isCurrentSessionResponse({ client, sessionId })) {
      return;
    }
    setBootstrap(buildReadyClaudeCodeComposerBootstrap(config));
    setSessionErrorMessage(null);
  }, [isCurrentSessionResponse, sessionSnapshot?.activeSessionId]);

  const resumeSession = useCallback(
    async (sessionId: string, resumeInput?: { directory?: string | null }): Promise<string> => {
      const client = clientRef.current;
      const connectedSession = sessionSnapshot;
      if (client === null || connectedSession === null) {
        throw new Error("Connect Claude Code before selecting a session.");
      }

      const navigationRequestId = sessionNavigationRequestSequenceRef.current + 1;
      sessionNavigationRequestSequenceRef.current = navigationRequestId;
      generationRef.current += 1;
      setPendingSessionId(sessionId);
      try {
        const directory = resolveClaudeCodeResumeDirectory({
          activeDirectory: connectedSession.activeDirectory,
          ...(resumeInput === undefined ? {} : { resumeInput }),
        });
        await client.resumeSession({
          cwd: directory,
          sessionId,
        });
        const session = await readClaudeCodeSessionWithRuntimeCatalogs({
          client,
          sessionId,
        });
        const sessionPage = await listClaudeCodeSessionPage({
          client,
          directory,
        });
        if (sessionNavigationRequestSequenceRef.current !== navigationRequestId) {
          return sessionId;
        }
        applyHydratedSession(session.session);
        setAvailableSessions(sessionPage.sessions);
        setHasMoreAvailableSessions(sessionPage.hasMore);
        updateSessionSnapshot({
          activeDirectory: session.session.cwd,
          activeSessionId: sessionId,
          connectedAtIso: new Date().toISOString(),
          providerSessionId: connectedSession.providerSessionId,
          sandboxInstanceId: connectedSession.sandboxInstanceId,
        });
        setSessionErrorMessage(null);
        return sessionId;
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not select Claude Code session.",
        );
        throw error;
      } finally {
        if (sessionNavigationRequestSequenceRef.current === navigationRequestId) {
          setPendingSessionId(null);
        }
      }
    },
    [applyHydratedSession, sessionSnapshot, updateSessionSnapshot],
  );

  const startNewSession = useCallback(
    async (startInput?: { directory?: string }): Promise<string> => {
      const client = clientRef.current;
      const connectedSession = sessionSnapshot;
      if (client === null || connectedSession === null) {
        throw new Error("Connect Claude Code before starting a session.");
      }

      const navigationRequestId = sessionNavigationRequestSequenceRef.current + 1;
      sessionNavigationRequestSequenceRef.current = navigationRequestId;
      generationRef.current += 1;
      setIsStartingNewSession(true);
      try {
        const session = await client.createSession({
          cwd: startInput?.directory ?? connectedSession.activeDirectory,
        });
        const hydratedSession = await readClaudeCodeSessionWithRuntimeCatalogs({
          client,
          sessionId: session.sessionId,
        });
        const sessionPage = await listClaudeCodeSessionPage({
          client,
          directory: startInput?.directory ?? connectedSession.activeDirectory,
        });
        if (sessionNavigationRequestSequenceRef.current !== navigationRequestId) {
          return session.sessionId;
        }
        applyHydratedSession(hydratedSession.session);
        setAvailableSessions(sessionPage.sessions);
        setHasMoreAvailableSessions(sessionPage.hasMore);
        updateSessionSnapshot({
          activeDirectory: hydratedSession.session.cwd,
          activeSessionId: session.sessionId,
          connectedAtIso: new Date().toISOString(),
          providerSessionId: connectedSession.providerSessionId,
          sandboxInstanceId: connectedSession.sandboxInstanceId,
        });
        setSessionErrorMessage(null);
        return session.sessionId;
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not start Claude Code session.",
        );
        throw error;
      } finally {
        if (sessionNavigationRequestSequenceRef.current === navigationRequestId) {
          setIsStartingNewSession(false);
        }
      }
    },
    [applyHydratedSession, sessionSnapshot, updateSessionSnapshot],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetSessionId: string | null }): void => {
      connectSession({
        ...recoverInput,
        providerSessionId: sessionSnapshot?.providerSessionId ?? null,
      });
    },
    [connectSession, sessionSnapshot?.providerSessionId],
  );

  return {
    bootstrap,
    contextUsage: activeContextUsage,
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
    modelControl: {
      refreshModelCatalog,
      setSessionConfig,
    },
    sessions: {
      activeSessionDirectory: sessionSnapshot?.activeDirectory ?? null,
      activeSessionId: sessionSnapshot?.activeSessionId ?? null,
      activeSessionStartedAt:
        createActiveClaudeCodeSessionSummary(sessionSnapshot)?.createdAt ?? null,
      availableSessions,
      hasMoreAvailableSessions,
      isStartingNewSession,
      originalSessionId,
      pendingSessionId,
      refreshSessionList,
      resumeSession,
      startNewSession,
    },
    chat: {
      canInterruptTurn: chatState.status === "busy",
      canSteerTurn: chatState.status === "busy",
      chatState,
      hydrateChatFromSessionOrThrow,
      interruptQuery,
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
