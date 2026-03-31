import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { OpenAiCodexAppServerListenUrl } from "../../../../../packages/integrations-definitions/src/openai/variants/openai-default/app-server.js";
import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
  shouldLifecycleAutoAttachChat,
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
  shouldLifecycleAutoAttachChat: boolean;
  handoffToCli: () => Promise<void>;
  handoffToChat: () => Promise<void>;
};

const ChatRestoreTimeoutMs = 30_000;

async function closeAndDisconnectCliPty(
  cliPtyState: ReturnType<typeof useSandboxPtyState>,
): Promise<void> {
  const closePromise = cliPtyState.actions.closePty().catch(() => {});
  const disconnectPromise = cliPtyState.actions.disconnectPty().catch(() => {});

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
  const restoreExecutionGenerationRef = useRef<number | null>(null);

  const nextGeneration = useCallback((): number => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  const clearRestoreTimeout = useCallback((): void => {
    if (restoreTimeoutIdRef.current === null) {
      return;
    }

    systemScheduler.cancel(restoreTimeoutIdRef.current);
    restoreTimeoutIdRef.current = null;
  }, []);

  const resetToStableChat = useCallback((): void => {
    clearRestoreTimeout();
    restoreGenerationRef.current = null;
    restoreExecutionGenerationRef.current = null;
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, [clearRestoreTimeout]);

  const startChatRestore = useCallback((): void => {
    const generation = nextGeneration();
    const durableThreadId = input.threadAuthority.providerThreadId;

    restoreGenerationRef.current = generation;
    restoreExecutionGenerationRef.current = null;
    clearRestoreTimeout();
    restoreTimeoutIdRef.current = systemScheduler.schedule(() => {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      restoreTimeoutIdRef.current = null;
      dispatch({
        type: "chat_restore_failed",
        errorMessage: "Timed out while restoring chat.",
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

    // Restore honors durable provider authority when one exists. Otherwise local
    // sessions intentionally reconnect using the most recently updated thread.
    input.lifecycle.connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      preferredThreadId: durableThreadId,
      ...(durableThreadId === null ? {} : { providerThreadId: durableThreadId }),
      selectionPolicy: durableThreadId === null ? "most_recently_updated" : "oldest",
    });
  }, [
    clearRestoreTimeout,
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

      input.threadAuthority.clearActiveThreadIdAfterCliLaunch();
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

    clearRestoreTimeout();
    dispatch({
      type: "chat_restore_failed",
      errorMessage: input.lifecycle.lifecycleErrorMessage,
    });
  }, [
    clearRestoreTimeout,
    input.lifecycle.lifecycleErrorMessage,
    isCurrentGeneration,
    state.transitionState,
  ]);

  useEffect(() => {
    const restoreGeneration = restoreGenerationRef.current;
    if (state.transitionState !== "restoring_chat" || restoreGeneration === null) {
      return;
    }

    if (input.lifecycle.transportState !== "connected") {
      return;
    }

    if (input.lifecycle.sessionSnapshot?.activeThreadId === null) {
      return;
    }

    if (restoreExecutionGenerationRef.current === restoreGeneration) {
      return;
    }

    restoreExecutionGenerationRef.current = restoreGeneration;

    void (async () => {
      try {
        await input.chat.hydrateChatFromThread();
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        clearRestoreTimeout();
        resetToStableChat();
      } catch (error) {
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        clearRestoreTimeout();
        restoreExecutionGenerationRef.current = null;
        dispatch({
          type: "chat_restore_failed",
          errorMessage: error instanceof Error ? error.message : "Could not restore chat.",
        });
      }
    })();
  }, [
    clearRestoreTimeout,
    input.chat,
    input.lifecycle.sessionSnapshot?.activeThreadId,
    input.lifecycle.transportState,
    input.threadAuthority,
    isCurrentGeneration,
    resetToStableChat,
    state.transitionState,
  ]);

  useEffect(() => {
    if (state.transitionState !== "stable_cli" || input.cliPtyState.lifecycle.exitInfo === null) {
      return;
    }

    startChatRestore();
  }, [input.cliPtyState.lifecycle.exitInfo, startChatRestore, state.transitionState]);

  useEffect(() => {
    generationRef.current += 1;
    clearRestoreTimeout();
    restoreGenerationRef.current = null;
    restoreExecutionGenerationRef.current = null;
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, [clearRestoreTimeout, input.sandboxInstanceId]);

  return {
    transitionState: state.transitionState,
    errorMessage: state.errorMessage,
    isCliToggleActive: isCliToggleActive(state.transitionState),
    shouldLifecycleAutoAttachChat: shouldLifecycleAutoAttachChat(state.transitionState),
    handoffToCli,
    handoffToChat,
  };
}
