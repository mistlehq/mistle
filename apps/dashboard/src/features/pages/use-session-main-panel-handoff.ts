import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { OpenAiCodexAppServerListenUrl } from "../../../../../packages/integrations-definitions/src/openai/variants/openai-default/app-server.js";
import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  getChatRestorePendingDetail,
  getChatRestoreStepLabel,
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
  shouldLifecycleAutoAttachChat,
  type ChatRestoreStep,
  type MainPanelTransitionState,
} from "./session-main-panel-handoff-state.js";

type UseSessionMainPanelHandoffInput = {
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  lifecycle: Pick<
    ReturnType<typeof useCodexSessionState>["lifecycle"],
    | "clearLifecycleErrorMessage"
    | "connectSession"
    | "detachSessionTransport"
    | "lifecycleErrorMessage"
    | "sessionSnapshot"
    | "transportState"
  >;
  sandboxInstanceId: string | null;
  serverRequests: Pick<
    ReturnType<typeof useCodexSessionState>["serverRequests"],
    "resetServerRequests"
  >;
  threadAuthority: ReturnType<typeof useCodexSessionState>["threadAuthority"];
  chat: Pick<ReturnType<typeof useCodexSessionState>["chat"], "hydrateChatFromThread">;
};

type SessionMainPanelHandoffResult = {
  transitionState: MainPanelTransitionState;
  errorMessage: string | null;
  isCliToggleActive: boolean;
  restoreStep: ChatRestoreStep | null;
  shouldLifecycleAutoAttachChat: boolean;
  handoffToCli: () => Promise<void>;
  handoffToChat: () => Promise<void>;
  retryRestoreChat: () => Promise<void>;
};

// Real restore performs token minting, websocket connect, JSON-RPC init, thread selection,
// and transcript hydration. A short timeout causes false restore failures against the real stack.
const ChatRestoreTimeoutMs = 30_000;

async function closeAndDisconnectCliPty(
  cliPtyState: ReturnType<typeof useSandboxPtyState>,
): Promise<void> {
  const closePromise = cliPtyState.actions.closePty().catch(() => {
    // Cleanup must be best-effort because the PTY may already be closed or exited.
  });
  const disconnectPromise = cliPtyState.actions.disconnectPty().catch(() => {
    // Cleanup must be best-effort because the websocket may already be gone.
  });

  await Promise.all([closePromise, disconnectPromise]);
}

export type { SessionMainPanelHandoffResult, UseSessionMainPanelHandoffInput };

export function useSessionMainPanelHandoff(
  input: UseSessionMainPanelHandoffInput,
): SessionMainPanelHandoffResult {
  const [state, dispatch] = useReducer(
    reduceSessionMainPanelHandoffState,
    InitialSessionMainPanelHandoffState,
  );
  const generationRef = useRef(0);
  const restoreGenerationRef = useRef<number | null>(null);
  const restoreTimeoutIdRef = useRef<TimerHandle | null>(null);
  const restoreStepRef = useRef<ChatRestoreStep | null>(null);
  const restoreExecutionGenerationRef = useRef<number | null>(null);

  const nextGeneration = useCallback((): number => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  const resetToStableChat = useCallback((): void => {
    if (restoreTimeoutIdRef.current !== null) {
      systemScheduler.cancel(restoreTimeoutIdRef.current);
      restoreTimeoutIdRef.current = null;
    }
    restoreGenerationRef.current = null;
    restoreStepRef.current = null;
    restoreExecutionGenerationRef.current = null;
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, []);

  const setRestoreStep = useCallback((restoreStep: ChatRestoreStep): void => {
    restoreStepRef.current = restoreStep;
    dispatch({
      type: "chat_restore_step_changed",
      restoreStep,
    });
  }, []);

  const buildRestoreTimeoutMessage = useCallback(
    (restoreStep: ChatRestoreStep | null): string => {
      if (restoreStep === null) {
        return "Timed out while restoring chat.";
      }

      const baseMessage = `Timed out while restoring chat during ${getChatRestoreStepLabel(restoreStep).toLowerCase()}.`;
      const pendingDetail = getChatRestorePendingDetail({
        restoreStep,
        lifecycleStep: input.lifecycle.transportState === "connected" ? "connected" : "connecting",
      });

      return pendingDetail === null ? baseMessage : `${baseMessage} Pending: ${pendingDetail}`;
    },
    [input.lifecycle.transportState],
  );

  const waitForRestoreStep = useCallback(
    async <T>(restoreStep: ChatRestoreStep, operation: Promise<T>): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        const timeout = systemScheduler.schedule(() => {
          reject(new Error(buildRestoreTimeoutMessage(restoreStep)));
        }, ChatRestoreTimeoutMs);

        void operation.then(
          (value) => {
            systemScheduler.cancel(timeout);
            resolve(value);
          },
          (error: unknown) => {
            systemScheduler.cancel(timeout);
            reject(error);
          },
        );
      });
    },
    [buildRestoreTimeoutMessage],
  );

  const startChatRestore = useCallback((): void => {
    const generation = nextGeneration();
    const preferredThreadId = input.threadAuthority.providerThreadId;

    restoreGenerationRef.current = generation;
    restoreStepRef.current = "connecting_transport";
    restoreExecutionGenerationRef.current = null;
    if (restoreTimeoutIdRef.current !== null) {
      systemScheduler.cancel(restoreTimeoutIdRef.current);
    }
    restoreTimeoutIdRef.current = systemScheduler.schedule(() => {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      restoreTimeoutIdRef.current = null;
      dispatch({
        type: "chat_restore_failed",
        errorMessage: buildRestoreTimeoutMessage(restoreStepRef.current),
      });
    }, ChatRestoreTimeoutMs);
    input.lifecycle.clearLifecycleErrorMessage();
    dispatch({
      type: "chat_restore_requested",
    });
    input.serverRequests.resetServerRequests();

    void closeAndDisconnectCliPty(input.cliPtyState);

    if (input.sandboxInstanceId === null) {
      dispatch({
        type: "chat_restore_failed",
        errorMessage: "Could not restore chat because the current session thread is unavailable.",
      });
      return;
    }

    input.lifecycle.connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      preferredThreadId,
      ...(preferredThreadId === null ? {} : { providerThreadId: preferredThreadId }),
      selectionPolicy: preferredThreadId === null ? "newest" : "oldest",
    });
  }, [
    buildRestoreTimeoutMessage,
    input.cliPtyState,
    input.lifecycle,
    input.sandboxInstanceId,
    input.serverRequests,
    input.threadAuthority,
    isCurrentGeneration,
    nextGeneration,
  ]);

  const handoffToCli = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      input.lifecycle.sessionSnapshot === null ||
      state.transitionState !== "stable_chat"
    ) {
      return;
    }

    const generation = nextGeneration();
    dispatch({
      type: "handoff_to_cli_requested",
    });

    try {
      const launchTarget = await input.threadAuthority.resolveCliLaunchTarget();
      if (!isCurrentGeneration(generation)) {
        return;
      }

      input.lifecycle.detachSessionTransport();
      input.serverRequests.resetServerRequests();

      let cliOpened = false;
      try {
        await input.cliPtyState.actions.openPty({
          sandboxInstanceId: input.sandboxInstanceId,
          ptySessionId: "cli",
          cols: 120,
          rows: 32,
          command: "codex",
          args:
            launchTarget.type === "resume"
              ? ["resume", "--remote", OpenAiCodexAppServerListenUrl, launchTarget.threadId]
              : ["--remote", OpenAiCodexAppServerListenUrl],
        });
        cliOpened = true;
      } catch (error) {
        if (cliOpened) {
          await closeAndDisconnectCliPty(input.cliPtyState);
        }
        throw error;
      }

      if (!isCurrentGeneration(generation)) {
        await closeAndDisconnectCliPty(input.cliPtyState);
        return;
      }

      input.threadAuthority.clearEphemeralActiveThreadIdAfterCliLaunch();
      dispatch({
        type: "cli_handoff_succeeded",
      });
    } catch (error) {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      dispatch({
        type: "cli_handoff_failed",
        errorMessage: error instanceof Error ? error.message : "Could not start Codex CLI.",
      });
    }
  }, [
    input.cliPtyState,
    input.lifecycle,
    input.sandboxInstanceId,
    input.serverRequests,
    input.threadAuthority,
    isCurrentGeneration,
    nextGeneration,
    state.transitionState,
  ]);

  const handoffToChat = useCallback(async (): Promise<void> => {
    if (
      state.transitionState !== "switching_to_cli" &&
      state.transitionState !== "stable_cli" &&
      state.transitionState !== "cli_entry_failed"
    ) {
      return;
    }

    startChatRestore();
  }, [startChatRestore, state.transitionState]);

  const retryRestoreChat = useCallback(async (): Promise<void> => {
    if (state.transitionState !== "restore_failed") {
      return;
    }

    startChatRestore();
  }, [startChatRestore, state.transitionState]);

  useEffect(() => {
    const restoreGeneration = restoreGenerationRef.current;
    if (state.transitionState !== "restoring_chat" || restoreGeneration === null) {
      return;
    }

    if (input.lifecycle.lifecycleErrorMessage === null) {
      return;
    }

    if (!isCurrentGeneration(restoreGeneration)) {
      return;
    }

    if (restoreTimeoutIdRef.current !== null) {
      systemScheduler.cancel(restoreTimeoutIdRef.current);
      restoreTimeoutIdRef.current = null;
    }
    dispatch({
      type: "chat_restore_failed",
      errorMessage: input.lifecycle.lifecycleErrorMessage,
    });
  }, [input.lifecycle.lifecycleErrorMessage, isCurrentGeneration, state.transitionState]);

  useEffect(() => {
    const restoreGeneration = restoreGenerationRef.current;
    if (state.transitionState !== "restoring_chat" || restoreGeneration === null) {
      return;
    }

    if (input.lifecycle.transportState !== "connected") {
      return;
    }

    if (restoreExecutionGenerationRef.current === restoreGeneration) {
      return;
    }

    restoreExecutionGenerationRef.current = restoreGeneration;

    void (async () => {
      try {
        setRestoreStep("resolving_thread");
        await waitForRestoreStep(
          "resolving_thread",
          input.threadAuthority.resolveRestoredThreadAuthorityAfterCli(),
        );
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        setRestoreStep("hydrating_chat");
        await waitForRestoreStep("hydrating_chat", input.chat.hydrateChatFromThread());
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        resetToStableChat();
      } catch (error) {
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        if (restoreTimeoutIdRef.current !== null) {
          systemScheduler.cancel(restoreTimeoutIdRef.current);
          restoreTimeoutIdRef.current = null;
        }
        restoreExecutionGenerationRef.current = null;
        dispatch({
          type: "chat_restore_failed",
          errorMessage: error instanceof Error ? error.message : "Could not restore chat.",
        });
      }
    })();
  }, [
    input.chat,
    input.lifecycle.transportState,
    input.threadAuthority,
    isCurrentGeneration,
    resetToStableChat,
    setRestoreStep,
    state.transitionState,
    waitForRestoreStep,
  ]);

  useEffect(() => {
    if (state.transitionState !== "stable_cli" || input.cliPtyState.lifecycle.exitInfo === null) {
      return;
    }

    startChatRestore();
  }, [input.cliPtyState.lifecycle.exitInfo, startChatRestore, state.transitionState]);

  useEffect(() => {
    generationRef.current += 1;
    if (restoreTimeoutIdRef.current !== null) {
      systemScheduler.cancel(restoreTimeoutIdRef.current);
      restoreTimeoutIdRef.current = null;
    }
    restoreGenerationRef.current = null;
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, [input.sandboxInstanceId]);

  return {
    transitionState: state.transitionState,
    errorMessage: state.errorMessage,
    isCliToggleActive: isCliToggleActive(state.transitionState),
    restoreStep: state.restoreStep,
    shouldLifecycleAutoAttachChat: shouldLifecycleAutoAttachChat(state.transitionState),
    handoffToCli,
    handoffToChat,
    retryRestoreChat,
  };
}
