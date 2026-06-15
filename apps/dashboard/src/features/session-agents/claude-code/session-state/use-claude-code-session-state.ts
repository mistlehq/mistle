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

export type ConnectedClaudeCodeThread = {
  activeDirectory: string | null;
  activeThreadId: string;
  connectedAtIso: string;
  providerThreadId: string | null;
  sandboxInstanceId: string;
};

export type ClaudeCodeSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    providerThreadId?: string | null;
    sandboxInstanceId: string;
    targetThreadId?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetThreadId: string | null }) => void;
  recoverableDisconnect: null;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedClaudeCodeThread | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type UseClaudeCodeSessionStateResult = {
  bootstrap: SessionComposerBootstrapResult;
  chat: {
    abortThread: () => Promise<void>;
    canInterruptTurn: boolean;
    canSteerTurn: boolean;
    chatState: ClaudeCodeChatState;
    hydrateChatFromThreadOrThrow: () => Promise<void>;
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
  const sessionSnapshotRef = useRef<ConnectedClaudeCodeThread | null>(null);
  const [step, setStep] = useState<ClaudeCodeSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedClaudeCodeThread | null>(null);
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

  const hydrateChatFromThreadOrThrow = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const threadId = sessionSnapshot?.activeThreadId ?? null;
    if (client === null || threadId === null) {
      throw new Error("Connect Claude Code before hydrating messages.");
    }

    const thread = await client.readThread({ threadId });
    dispatchChatAction({
      type: "hydrate_thread",
      thread: thread.thread,
    });
    setSessionErrorMessage(null);
  }, [sessionSnapshot?.activeThreadId]);

  const pollThreadUntilIdle = useCallback(
    async (input: { client: ClaudeCodeSessionClient; generation: number; threadId: string }) => {
      while (generationRef.current === input.generation) {
        const thread = await input.client.readThread({
          threadId: input.threadId,
        });
        if (generationRef.current !== input.generation) {
          return;
        }
        dispatchChatAction({
          type: "hydrate_thread",
          thread: thread.thread,
        });
        if (thread.thread.status.type !== "active") {
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
      providerThreadId?: string | null;
      sandboxInstanceId: string;
      targetThreadId?: string | null;
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
          const targetThreadId =
            connectInput.targetThreadId ?? connectInput.providerThreadId ?? null;
          let activeThreadId: string;
          if (targetThreadId === null) {
            const createdThread = await client.createThread({
              ...(connectInput.initialCwd === undefined ? {} : { cwd: connectInput.initialCwd }),
            });
            activeThreadId = createdThread.threadId;
          } else {
            await client.resumeThread({
              threadId: targetThreadId,
            });
            activeThreadId = targetThreadId;
          }
          const thread = await client.readThread({
            threadId: activeThreadId,
          });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          dispatchChatAction({
            type: "hydrate_thread",
            thread: thread.thread,
          });
          setBootstrap(ReadyClaudeCodeBootstrap);
          setSessionSnapshot({
            activeDirectory: thread.thread.cwd ?? connectInput.initialCwd ?? null,
            activeThreadId,
            connectedAtIso: new Date().toISOString(),
            providerThreadId: connectInput.providerThreadId ?? null,
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
      const threadId = sessionSnapshot?.activeThreadId ?? null;
      if (client === null || threadId === null) {
        throw new Error("Connect Claude Code before sending a prompt.");
      }
      const prompt = promptInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Claude Code prompt must not be empty.");
      }
      const generation = generationRef.current;
      setIsStartingTurn(true);
      try {
        const turn = await client.startTurn({
          threadId,
          inputText: prompt,
        });
        dispatchChatAction({
          type: "prompt_submitted",
          threadId,
          submittedPrompt: prompt,
          turnId: turn.turnId,
        });
        setSessionErrorMessage(null);
        await pollThreadUntilIdle({
          client,
          generation,
          threadId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not send Claude Code prompt.";
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
    [pollThreadUntilIdle, sessionSnapshot?.activeThreadId],
  );

  const steerTurn = useCallback(
    async (steerInput: { submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const threadId = sessionSnapshot?.activeThreadId ?? null;
      if (client === null || threadId === null) {
        throw new Error("Connect Claude Code before steering.");
      }
      const prompt = steerInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("Claude Code steering prompt must not be empty.");
      }
      const generation = generationRef.current;
      setIsSteeringTurn(true);
      try {
        await client.steerTurn({
          threadId,
          inputText: prompt,
        });
        setSessionErrorMessage(null);
        await pollThreadUntilIdle({
          client,
          generation,
          threadId,
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
    [pollThreadUntilIdle, sessionSnapshot?.activeThreadId],
  );

  const abortThread = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const threadId = sessionSnapshot?.activeThreadId ?? null;
    if (client === null || threadId === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.interruptTurn({
        threadId,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [sessionSnapshot?.activeThreadId]);

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetThreadId: string | null }): void => {
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
      abortThread,
      canInterruptTurn: chatState.status === "busy",
      canSteerTurn: chatState.status === "busy",
      chatState,
      hydrateChatFromThreadOrThrow,
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
