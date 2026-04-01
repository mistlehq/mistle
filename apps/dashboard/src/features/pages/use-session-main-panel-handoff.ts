import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
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
  error: {
    kind: "cli_handoff_failed" | "chat_restore_failed";
    message: string | null;
  } | null;
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

  const resetRestoreState = useCallback((): void => {
    clearRestoreTimeout();
    restoreGenerationRef.current = null;
    restoreExecutionGenerationRef.current = null;
  }, [clearRestoreTimeout]);

  const failRestore = useCallback(
    (errorMessage: string): void => {
      resetRestoreState();
      dispatch({
        type: "chat_restore_failed",
        errorMessage,
      });
    },
    [resetRestoreState],
  );

  const resetToStableChat = useCallback((): void => {
    resetRestoreState();
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, [resetRestoreState]);

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

      failRestore("Timed out while restoring chat.");
    }, ChatRestoreTimeoutMs);
    input.lifecycle.clearLifecycleErrorMessage();
    dispatch({
      type: "chat_restore_requested",
    });
    input.serverRequests.resetServerRequests();

    void closeAndDisconnectCliPty(input.cliPtyState);

    if (input.sandboxInstanceId === null) {
      failRestore("Could not restore chat because the current session thread is unavailable.");
      return;
    }

    // Restore honors durable provider authority when one exists. Otherwise local
    // sessions intentionally reconnect using the most recently updated thread.
    input.lifecycle.connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: durableThreadId,
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
              ? ["resume", "--remote", CodexAppServerListenUrl, launchTarget.threadId]
              : ["--remote", CodexAppServerListenUrl],
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

      input.threadAuthority.clearActiveThreadIdAfterCliLaunch(launchTarget);
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
    if (state.transitionState !== "switching_to_cli" && state.transitionState !== "stable_cli") {
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
    failRestore(input.lifecycle.lifecycleErrorMessage);
  }, [
    failRestore,
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

        resetToStableChat();
      } catch (error) {
        if (!isCurrentGeneration(restoreGeneration)) {
          return;
        }

        restoreExecutionGenerationRef.current = null;
        failRestore(error instanceof Error ? error.message : "Could not restore chat.");
      }
    })();
  }, [
    failRestore,
    input.chat,
    input.lifecycle.sessionSnapshot?.activeThreadId,
    input.lifecycle.transportState,
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
    resetRestoreState();
    dispatch({
      type: "reset_to_stable_chat",
    });
  }, [input.sandboxInstanceId, resetRestoreState]);

  return {
    transitionState: state.transitionState,
    error: state.error,
    isCliToggleActive: isCliToggleActive(state.transitionState),
    shouldLifecycleAutoAttachChat: state.transitionState === "stable_chat",
    handoffToCli,
    handoffToChat,
  };
}
