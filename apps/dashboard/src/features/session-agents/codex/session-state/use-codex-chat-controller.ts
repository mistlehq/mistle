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

function buildTurnRequest(input: {
  submittedPrompt: string;
  submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
  transcriptPrompt?: string;
  displayAttachments?: readonly CodexTurnInputLocalImageItem[];
}): {
  submittedPrompt: string;
  transcriptPrompt: string;
  submittedAttachments: readonly CodexTurnInputLocalImageItem[];
  displayAttachments: readonly CodexTurnInputLocalImageItem[];
  items: ReturnType<typeof buildCodexTurnInputItems>;
} {
  const submittedPrompt = input.submittedPrompt.trim();
  const transcriptPrompt = (input.transcriptPrompt ?? input.submittedPrompt).trim();
  const submittedAttachments = input.submittedAttachments ?? [];
  const displayAttachments = input.displayAttachments ?? submittedAttachments;

  return {
    submittedPrompt,
    transcriptPrompt,
    submittedAttachments,
    displayAttachments,
    items: buildCodexTurnInputItems({
      text: submittedPrompt,
      attachments: submittedAttachments,
    }),
  };
}

export function useCodexChatController(input: {
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  threadIdRef: MutableRefObject<string | null>;
  setSessionErrorMessage: (message: string | null) => void;
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

  const hydrateThreadStateFromRead = useCallback(
    async (hydrateInput?: {
      rpcClient?: CodexJsonRpcClient;
      threadId?: string | null;
      generation?: number;
      ensureCurrentGeneration?: (generation: number) => void;
    }): Promise<"empty" | "hydrated"> => {
      const rpcClient = hydrateInput?.rpcClient ?? input.rpcClientRef.current;
      const threadId = hydrateInput?.threadId ?? input.threadIdRef.current;

      if (rpcClient === null || threadId === null) {
        return "empty";
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
        return "hydrated";
      } catch (error) {
        if (isThreadNotMaterializedError(error)) {
          dispatchChatAction({ type: "reset" });
          input.setSessionErrorMessage(null);
          return "empty";
        }

        throw error;
      }
    },
    [input.rpcClientRef, input.setSessionErrorMessage, input.threadIdRef],
  );

  const hydrateInitialThread = useCallback(
    async (hydrateInput?: {
      rpcClient?: CodexJsonRpcClient;
      threadId?: string | null;
      generation?: number;
      ensureCurrentGeneration?: (generation: number) => void;
    }): Promise<"empty" | "hydrated"> => {
      return await hydrateThreadStateFromRead(hydrateInput);
    },
    [hydrateThreadStateFromRead],
  );

  const hydrateChatFromThread = useCallback(async (): Promise<void> => {
    await hydrateThreadStateFromRead();
  }, [hydrateThreadStateFromRead]);

  const startTurnMutation = useMutation({
    mutationFn: async (turnInput: {
      submittedPrompt: string;
      submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
      transcriptPrompt?: string;
      displayAttachments?: readonly CodexTurnInputLocalImageItem[];
    }) => {
      const rpcClient = input.rpcClientRef.current;
      const threadId = input.threadIdRef.current;

      if (rpcClient === null || threadId === null) {
        throw new Error("Choose a thread before starting a turn.");
      }

      const turnRequest = buildTurnRequest(turnInput);

      const clientTurnId = createPendingTurnId();
      dispatchChatAction({
        type: "start_turn_requested",
        clientTurnId,
        prompt: turnRequest.transcriptPrompt,
        attachments: turnRequest.displayAttachments,
      });

      try {
        const startedTurn = await startCodexTurn({
          rpcClient,
          threadId,
          input: turnRequest.items,
        });
        dispatchChatAction({
          type: "turn_started_response",
          clientTurnId,
          turnId: startedTurn.turnId,
          status: startedTurn.status,
        });
      } catch (error) {
        dispatchChatAction({
          type: "start_turn_failed",
          clientTurnId,
        });
        throw error;
      }
    },
  });

  const reloadChatMutation = useMutation({
    mutationFn: async () => {
      await hydrateChatFromThread();
    },
    onError: (error) => {
      input.setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not reload chat.",
      );
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

      await interruptCodexTurn({
        rpcClient,
        threadId,
        turnId,
      });
    },
    onError: (error) => {
      input.setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not interrupt turn.",
      );
    },
  });

  const steerTurnMutation = useMutation({
    mutationFn: async (turnInput: {
      submittedPrompt: string;
      submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
      transcriptPrompt?: string;
      displayAttachments?: readonly CodexTurnInputLocalImageItem[];
    }) => {
      const rpcClient = input.rpcClientRef.current;
      const threadId = input.threadIdRef.current;
      const turnId = chatState.activeTurnId;

      if (rpcClient === null || threadId === null || turnId === null) {
        throw new Error("No active turn is available to steer.");
      }

      const turnRequest = buildTurnRequest(turnInput);

      await steerCodexTurn({
        rpcClient,
        threadId,
        turnId,
        input: turnRequest.items,
      });
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
    hydrateInitialThread,
    hydrateChatFromThread,
    isStartingTurn: startTurnMutation.isPending,
    isReloadingChat: reloadChatMutation.isPending,
    isInterruptingTurn: interruptTurnMutation.isPending,
    isSteeringTurn: steerTurnMutation.isPending,
    canInterruptTurn,
    canSteerTurn,
    startTurn: useCallback(
      async (turnInput: {
        submittedPrompt: string;
        submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
        transcriptPrompt?: string;
        displayAttachments?: readonly CodexTurnInputLocalImageItem[];
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
        submittedPrompt: string;
        submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
        transcriptPrompt?: string;
        displayAttachments?: readonly CodexTurnInputLocalImageItem[];
      }): Promise<void> => {
        await steerTurnMutation.mutateAsync(turnInput);
      },
      [steerTurnMutation],
    ),
  };
}

export type UseCodexChatControllerResult = ReturnType<typeof useCodexChatController>;
export type { CodexChatState };
