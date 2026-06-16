import {
  createClaudeCodeSessionClient,
  type ClaudeCodeSessionClient,
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
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

const ClaudeCodeTurnPollIntervalMs = 1_000;

const ReadyClaudeCodeBootstrap: SessionComposerBootstrapResult = {
  phase: { status: "ready" },
  composerCapabilities: [
    {
      kind: "contextMention",
      trigger: "@",
      source: "workspacePath",
      insertAs: "relativePathText",
      submitAs: "inlineText",
    },
  ],
  establishedSnapshot: {
    availableModels: [],
    configSnapshot: {
      model: null,
      modelReasoningEffort: null,
    },
  },
};

function buildUnavailableClaudeCodeBootstrap(
  phase: SessionComposerBootstrapResult["phase"],
): SessionComposerBootstrapResult {
  return {
    ...ReadyClaudeCodeBootstrap,
    phase,
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
  const [bootstrap, setBootstrap] = useState<SessionComposerBootstrapResult>(
    buildUnavailableClaudeCodeBootstrap({ status: "unavailable" }),
  );

  useEffect(() => {
    sessionSnapshotRef.current = sessionSnapshot;
  }, [sessionSnapshot]);

  const clearLifecycleErrorMessage = useCallback((): void => {
    setLifecycleErrorMessage(null);
  }, []);

  const clearSessionErrorMessage = useCallback((): void => {
    setSessionErrorMessage(null);
  }, []);

  const reportSessionErrorMessage = useCallback((message: string): void => {
    setSessionErrorMessage(message);
  }, []);

  const disconnectSession = useCallback((): void => {
    generationRef.current += 1;
    clientRef.current?.close();
    clientRef.current = null;
    setBootstrap(buildUnavailableClaudeCodeBootstrap({ status: "unavailable" }));
    setSessionSnapshot(null);
    setSessionConnectionState("detached");
    setStep("idle");
  }, []);

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

    const session = await client.readSession({ sessionId });
    dispatchChatAction({
      type: "hydrate_session",
      session: session.session,
    });
    setSessionErrorMessage(null);
  }, [sessionSnapshot?.activeSessionId]);

  const pollSessionUntilIdle = useCallback(
    async (input: { client: ClaudeCodeSessionClient; generation: number; sessionId: string }) => {
      while (generationRef.current === input.generation) {
        const session = await input.client.readSession({
          sessionId: input.sessionId,
        });
        if (generationRef.current !== input.generation) {
          return;
        }
        dispatchChatAction({
          type: "hydrate_session",
          session: session.session,
        });
        if (session.session.status.type !== "active") {
          return;
        }
        await systemSleeper.sleep(ClaudeCodeTurnPollIntervalMs);
      }
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
      clientRef.current?.close();
      clientRef.current = null;
      setBootstrap(buildUnavailableClaudeCodeBootstrap({ status: "bootstrapping" }));
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
          const client = createClaudeCodeSessionClient({
            transport: transportConnection.transport,
          });
          clientRef.current = client;
          await client.connect();
          const targetSessionId =
            connectInput.targetSessionId ?? connectInput.providerSessionId ?? null;
          let activeSessionId: string;
          if (targetSessionId === null) {
            const createdSession = await client.createSession({
              ...(connectInput.initialCwd === undefined ? {} : { cwd: connectInput.initialCwd }),
            });
            activeSessionId = createdSession.sessionId;
          } else {
            await client.resumeSession({
              sessionId: targetSessionId,
            });
            activeSessionId = targetSessionId;
          }
          const session = await client.readSession({
            sessionId: activeSessionId,
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          dispatchChatAction({
            type: "hydrate_session",
            session: session.session,
          });
          setBootstrap(ReadyClaudeCodeBootstrap);
          setSessionSnapshot({
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
          setSessionSnapshot(null);
          setLifecycleErrorMessage(message);
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [ensureTransportConnected],
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
    if (client === null || sessionId === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.interruptQuery({
        sessionId,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [sessionSnapshot?.activeSessionId]);

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetSessionId: string | null }): void => {
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
