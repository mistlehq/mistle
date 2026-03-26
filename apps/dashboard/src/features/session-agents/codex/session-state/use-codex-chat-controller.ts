import {
  buildCodexTurnInputItems,
  interruptCodexTurn,
  readCodexThread,
  startCodexTurn,
  steerCodexTurn,
  type CodexTurnInputLocalImageItem,
  type CodexJsonRpcClient,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useReducer, type MutableRefObject } from "react";

import {
  createInitialCodexChatState,
  reduceCodexChatState,
  type CodexChatState,
} from "./codex-chat-state.js";

function isThreadNotMaterializedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("includeTurns is unavailable before first user message");
}

function createPendingTurnId(): string {
  return `pending:${crypto.randomUUID()}`;
}

export function useCodexChatController(input: {
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  threadIdRef: MutableRefObject<string | null>;
  recordRecentResponse: (payload: unknown) => void;
  setStartErrorMessage: (message: string | null) => void;
}) {
  const [chatState, dispatchChatAction] = useReducer(
    reduceCodexChatState,
    undefined,
    createInitialCodexChatState,
  );

  const resetChat = useCallback((): void => {
    dispatchChatAction({ type: "reset" });
  }, []);

  const handleNotificationReceived = useCallback(
    (notification: { method: string; params?: unknown }): void => {
      dispatchChatAction({
        type: "notification_received",
        notification,
      });
    },
    [],
  );

  const hydrateChatFromThread = useCallback(
    async (hydrateInput?: {
      rpcClient?: CodexJsonRpcClient;
      threadId?: string | null;
      generation?: number;
      ensureCurrentGeneration?: (generation: number) => void;
    }): Promise<void> => {
      const rpcClient = hydrateInput?.rpcClient ?? input.rpcClientRef.current;
      const threadId = hydrateInput?.threadId ?? input.threadIdRef.current;

      if (rpcClient === null || threadId === null) {
        return;
      }

      try {
        const thread = await readCodexThread({
          rpcClient,
          threadId,
        });
        if (
          hydrateInput?.generation !== undefined &&
          hydrateInput.ensureCurrentGeneration !== undefined
        ) {
          hydrateInput.ensureCurrentGeneration(hydrateInput.generation);
        }

        dispatchChatAction({
          type: "hydrate_from_thread_read",
          turns: thread.turns,
        });
        input.recordRecentResponse(thread.response);
      } catch (error) {
        if (isThreadNotMaterializedError(error)) {
          dispatchChatAction({ type: "reset" });
          input.setStartErrorMessage(null);
          return;
        }

        input.setStartErrorMessage(
          error instanceof Error ? error.message : "Could not read thread.",
        );
      }
    },
    [input],
  );

  const startTurnMutation = useMutation({
    mutationFn: async (turnInput: {
      prompt: string;
      attachments?: readonly CodexTurnInputLocalImageItem[];
    }) => {
      const rpcClient = input.rpcClientRef.current;
      const threadId = input.threadIdRef.current;

      if (rpcClient === null || threadId === null) {
        throw new Error("Choose a thread before starting a turn.");
      }

      const trimmedPrompt = turnInput.prompt.trim();
      const turnItems = buildCodexTurnInputItems({
        text: trimmedPrompt,
        attachments: turnInput.attachments ?? [],
      });

      const clientTurnId = createPendingTurnId();
      dispatchChatAction({
        type: "start_turn_requested",
        clientTurnId,
        prompt: trimmedPrompt,
      });

      try {
        const startedTurn = await startCodexTurn({
          rpcClient,
          threadId,
          input: turnItems,
        });
        dispatchChatAction({
          type: "turn_started_response",
          clientTurnId,
          turnId: startedTurn.turnId,
          status: startedTurn.status,
        });
        input.recordRecentResponse(startedTurn.response);
      } catch (error) {
        dispatchChatAction({
          type: "start_turn_failed",
          clientTurnId,
        });
        throw error;
      }
    },
    onError: (error) => {
      input.setStartErrorMessage(error instanceof Error ? error.message : "Could not start turn.");
    },
  });

  const reloadChatMutation = useMutation({
    mutationFn: async () => {
      await hydrateChatFromThread();
    },
    onError: (error) => {
      input.setStartErrorMessage(error instanceof Error ? error.message : "Could not reload chat.");
    },
  });

  const interruptTurnMutation = useMutation({
    mutationFn: async () => {
      const rpcClient = input.rpcClientRef.current;
      const threadId = input.threadIdRef.current;
      const turnId = chatState.activeTurnId;

      if (rpcClient === null || threadId === null || turnId === null) {
        throw new Error("No active turn is available to interrupt.");
      }

      const interruptedTurn = await interruptCodexTurn({
        rpcClient,
        threadId,
        turnId,
      });

      input.recordRecentResponse(interruptedTurn.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not interrupt turn.",
      );
    },
  });

  const steerTurnMutation = useMutation({
    mutationFn: async (turnInput: {
      prompt: string;
      attachments?: readonly CodexTurnInputLocalImageItem[];
    }) => {
      const rpcClient = input.rpcClientRef.current;
      const threadId = input.threadIdRef.current;
      const turnId = chatState.activeTurnId;

      if (rpcClient === null || threadId === null || turnId === null) {
        throw new Error("No active turn is available to steer.");
      }

      const trimmedPrompt = turnInput.prompt.trim();
      const turnItems = buildCodexTurnInputItems({
        text: trimmedPrompt,
        attachments: turnInput.attachments ?? [],
      });

      const steeredTurn = await steerCodexTurn({
        rpcClient,
        threadId,
        turnId,
        input: turnItems,
      });

      input.recordRecentResponse(steeredTurn.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(error instanceof Error ? error.message : "Could not steer turn.");
    },
  });

  const hasActiveThread = input.threadIdRef.current !== null;
  const canInterruptTurn =
    hasActiveThread &&
    chatState.activeTurnId !== null &&
    chatState.status === "inProgress" &&
    !interruptTurnMutation.isPending;
  const canSteerTurn =
    hasActiveThread &&
    chatState.activeTurnId !== null &&
    chatState.status === "inProgress" &&
    !steerTurnMutation.isPending;

  return {
    chatState,
    resetChat,
    handleNotificationReceived,
    hydrateChatFromThread,
    isStartingTurn: startTurnMutation.isPending,
    isReloadingChat: reloadChatMutation.isPending,
    isInterruptingTurn: interruptTurnMutation.isPending,
    isSteeringTurn: steerTurnMutation.isPending,
    canInterruptTurn,
    canSteerTurn,
    startTurn: useCallback(
      async (turnInput: {
        prompt: string;
        attachments?: readonly CodexTurnInputLocalImageItem[];
      }): Promise<void> => {
        await startTurnMutation.mutateAsync(turnInput);
      },
      [startTurnMutation],
    ),
    reloadChat: useCallback(() => {
      reloadChatMutation.mutate();
    }, [reloadChatMutation]),
    interruptTurn: useCallback(() => {
      interruptTurnMutation.mutate();
    }, [interruptTurnMutation]),
    steerTurn: useCallback(
      async (turnInput: {
        prompt: string;
        attachments?: readonly CodexTurnInputLocalImageItem[];
      }): Promise<void> => {
        await steerTurnMutation.mutateAsync(turnInput);
      },
      [steerTurnMutation],
    ),
  };
}

export type UseCodexChatControllerResult = ReturnType<typeof useCodexChatController>;
export type { CodexChatState };
