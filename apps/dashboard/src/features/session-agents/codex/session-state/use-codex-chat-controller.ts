import {
  buildCodexTurnInputItems,
  interruptCodexTurn,
  startCodexTurn,
  steerCodexTurn,
  type CodexTurnInputLocalImageItem,
  type CodexJsonRpcClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useReducer, useRef, useState, type RefObject } from "react";

import {
  createInitialCodexChatState,
  reduceCodexChatState,
  type CodexChatState,
} from "./codex-chat-state.js";
import { readCodexThreadState } from "./codex-thread-read-state.js";

function createPendingTurnId(): string {
  return `pending:${crypto.randomUUID()}`;
}

function createSteerEntryId(): string {
  return `steer:${crypto.randomUUID()}`;
}

type QueuedSteerRequest = {
  entryId: string;
  threadId: string;
  turnId: string;
  request: ReturnType<typeof buildTurnRequest>;
  status: "queued" | "sending";
};

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
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
  threadIdRef: RefObject<string | null>;
  setSessionErrorMessage: (message: string | null) => void;
}) {
  const [chatState, dispatchChatAction] = useReducer(
    reduceCodexChatState,
    undefined,
    createInitialCodexChatState,
  );
  const activeTurnIdRef = useRef<string | null>(chatState.activeTurnId);
  const chatStatusRef = useRef<string | null>(chatState.status);
  const queuedSteerRequestsRef = useRef<QueuedSteerRequest[]>([]);
  const isProcessingSteerQueueRef = useRef(false);
  const [pendingSteerCount, setPendingSteerCount] = useState(0);
  activeTurnIdRef.current = chatState.activeTurnId;
  chatStatusRef.current = chatState.status;

  const syncPendingSteerCount = useCallback(() => {
    setPendingSteerCount(queuedSteerRequestsRef.current.length);
  }, []);

  const resetChat = useCallback((): void => {
    queuedSteerRequestsRef.current = [];
    isProcessingSteerQueueRef.current = false;
    syncPendingSteerCount();
    dispatchChatAction({ type: "reset" });
  }, [syncPendingSteerCount]);

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

      const thread = await readCodexThreadState({
        rpcClient,
        threadId,
      });
      if (thread.status === "unmaterialized") {
        dispatchChatAction({ type: "reset" });
        input.setSessionErrorMessage(null);
        return "empty";
      }

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

  const processSteerQueue = useCallback((): void => {
    if (isProcessingSteerQueueRef.current) {
      return;
    }

    isProcessingSteerQueueRef.current = true;

    void (async () => {
      try {
        while (queuedSteerRequestsRef.current.length > 0) {
          const queuedRequest = queuedSteerRequestsRef.current[0];
          if (queuedRequest === undefined) {
            break;
          }

          const rpcClient = input.rpcClientRef.current;
          const threadId = input.threadIdRef.current;
          const isQueuedTurnStillActive =
            activeTurnIdRef.current === queuedRequest.turnId &&
            chatStatusRef.current === "inProgress";

          if (
            rpcClient === null ||
            threadId === null ||
            threadId !== queuedRequest.threadId ||
            !isQueuedTurnStillActive
          ) {
            dispatchChatAction({
              type: "steer_turn_failed",
              entryId: queuedRequest.entryId,
              turnId: queuedRequest.turnId,
            });
            queuedSteerRequestsRef.current = queuedSteerRequestsRef.current.filter(
              (request) => request.entryId !== queuedRequest.entryId,
            );
            syncPendingSteerCount();
            continue;
          }

          queuedSteerRequestsRef.current = queuedSteerRequestsRef.current.map((request) =>
            request.entryId !== queuedRequest.entryId
              ? request
              : {
                  ...request,
                  status: "sending",
                },
          );
          dispatchChatAction({
            type: "steer_turn_sending",
            entryId: queuedRequest.entryId,
            turnId: queuedRequest.turnId,
          });

          try {
            await steerCodexTurn({
              rpcClient,
              threadId,
              turnId: queuedRequest.turnId,
              input: queuedRequest.request.items,
            });
            dispatchChatAction({
              type: "steer_turn_processed",
              entryId: queuedRequest.entryId,
              turnId: queuedRequest.turnId,
            });
          } catch (error) {
            dispatchChatAction({
              type: "steer_turn_failed",
              entryId: queuedRequest.entryId,
              turnId: queuedRequest.turnId,
            });
            input.setSessionErrorMessage(
              error instanceof Error ? error.message : "Could not steer turn.",
            );
          } finally {
            queuedSteerRequestsRef.current = queuedSteerRequestsRef.current.filter(
              (request) => request.entryId !== queuedRequest.entryId,
            );
            syncPendingSteerCount();
          }
        }
      } finally {
        isProcessingSteerQueueRef.current = false;
        if (queuedSteerRequestsRef.current.length > 0) {
          processSteerQueue();
        }
      }
    })();
  }, [input.rpcClientRef, input.setSessionErrorMessage, input.threadIdRef, syncPendingSteerCount]);

  const hasActiveThread = input.threadIdRef.current !== null;
  const canInterruptTurn =
    hasActiveThread &&
    chatState.activeTurnId !== null &&
    chatState.status === "inProgress" &&
    !interruptTurnMutation.isPending;
  const canSteerTurn =
    hasActiveThread && chatState.activeTurnId !== null && chatState.status === "inProgress";

  return {
    chatState,
    resetChat,
    handleNotificationReceived,
    hydrateInitialThread,
    hydrateChatFromThread,
    isStartingTurn: startTurnMutation.isPending,
    isReloadingChat: reloadChatMutation.isPending,
    isInterruptingTurn: interruptTurnMutation.isPending,
    isSteeringTurn: pendingSteerCount > 0,
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
    dismissUserMessageAction: useCallback(
      (actionId: string) => {
        const matchingQueuedRequest = queuedSteerRequestsRef.current.find(
          (request) => request.entryId === actionId,
        );
        if (
          actionId.length === 0 ||
          matchingQueuedRequest === undefined ||
          matchingQueuedRequest.status !== "queued"
        ) {
          return;
        }

        const turnId = matchingQueuedRequest.turnId;
        queuedSteerRequestsRef.current = queuedSteerRequestsRef.current.filter(
          (request) => request.entryId !== actionId,
        );
        syncPendingSteerCount();
        dispatchChatAction({
          type: "dismiss_client_user_entry",
          entryId: actionId,
          turnId,
        });
      },
      [syncPendingSteerCount],
    ),
    steerTurn: useCallback(
      async (turnInput: {
        submittedPrompt: string;
        submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
        transcriptPrompt?: string;
        displayAttachments?: readonly CodexTurnInputLocalImageItem[];
      }): Promise<void> => {
        const rpcClient = input.rpcClientRef.current;
        const threadId = input.threadIdRef.current;
        const turnId = activeTurnIdRef.current;

        if (rpcClient === null || threadId === null || turnId === null) {
          throw new Error("No active turn is available to steer.");
        }

        const turnRequest = buildTurnRequest(turnInput);
        const steerEntryId = createSteerEntryId();

        dispatchChatAction({
          type: "steer_turn_requested",
          entryId: steerEntryId,
          turnId,
          prompt: turnRequest.transcriptPrompt,
          attachments: turnRequest.displayAttachments,
        });
        queuedSteerRequestsRef.current = [
          ...queuedSteerRequestsRef.current,
          {
            entryId: steerEntryId,
            threadId,
            turnId,
            request: turnRequest,
            status: "queued",
          },
        ];
        syncPendingSteerCount();
        processSteerQueue();
      },
      [input.rpcClientRef, input.threadIdRef, processSteerQueue, syncPendingSteerCount],
    ),
  };
}

export type UseCodexChatControllerResult = ReturnType<typeof useCodexChatController>;
export type { CodexChatState };
