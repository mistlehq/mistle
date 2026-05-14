import { resolveAgentPtyLaunchTemplate } from "@mistle/integrations-core";
import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { OpenCodePtyLaunchSpec } from "@mistle/integrations-definitions/agent-runtimes/opencode/pty-launch";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
  type MainPanelTransitionState,
} from "./session-main-panel-handoff-state.js";

type SessionMainPanelRuntimeId = "codex" | "opencode";
type ChatRestoreConnectionInput =
  | {
      initialCwd?: string | null;
      providerThreadId?: string;
      sandboxInstanceId: string;
      selectionPolicy?: never;
      targetThreadId: string;
    }
  | {
      initialCwd?: string | null;
      providerThreadId?: never;
      sandboxInstanceId: string;
      selectionPolicy?: "most_recently_updated";
      targetThreadId: null;
    };

type SessionCliLaunchTarget =
  | {
      type: "resume";
      threadId: string;
    }
  | {
      type: "start_new";
      shouldClearActiveThreadId: boolean;
    };

type SessionMainPanelHandoffLifecycleSnapshot = {
  activeConversationId: string | null;
};

type SessionMainPanelHandoffLifecycle = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: ChatRestoreConnectionInput) => void;
  detachSessionConnection: () => void;
  lifecycleErrorMessage: string | null;
  sessionConnectionState: "connected" | "connecting" | "detached" | "recovering";
  sessionSnapshot: SessionMainPanelHandoffLifecycleSnapshot | null;
};

type SessionMainPanelHandoffRuntime = {
  clearActiveThreadIdAfterCliLaunch: (launchTarget: SessionCliLaunchTarget) => void;
  displayName: string;
  hydrateChatFromConversation: () => Promise<void>;
  lifecycle: SessionMainPanelHandoffLifecycle;
  preserveCliLaunchForRestore: boolean;
  resetServerRequests: () => void;
  restoreConversationId: string | null;
  resolveCliLaunchTarget: () => Promise<SessionCliLaunchTarget>;
};

type UseSessionMainPanelHandoffInput = {
  activeRuntimeIdRef: RefObject<SessionMainPanelRuntimeId>;
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  runtimes: Record<SessionMainPanelRuntimeId, SessionMainPanelHandoffRuntime>;
  selectedRepositoryPathRef: RefObject<string | null>;
  sandboxInstanceId: string | null;
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

export function buildCliPtyOpenInput(input: {
  launchTarget: SessionCliLaunchTarget;
  runtimeId: SessionMainPanelRuntimeId;
  sandboxInstanceId: string;
  selectedRepositoryPath: string | null;
}): {
  sandboxInstanceId: string;
  ptySessionId: "cli";
  cols: number;
  rows: number;
  command: "codex" | "opencode";
  args: string[];
  cwd?: string;
} {
  if (input.runtimeId === "opencode") {
    const launch = resolveAgentPtyLaunchTemplate({
      launch: OpenCodePtyLaunchSpec,
      threadId: input.launchTarget.type === "resume" ? input.launchTarget.threadId : null,
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
      ptySessionId: "cli",
      cols: launch.cols,
      rows: launch.rows,
      command: "opencode",
      args:
        input.selectedRepositoryPath === null
          ? launch.args
          : [...launch.args, "--dir", input.selectedRepositoryPath],
      ...(input.selectedRepositoryPath === null ? {} : { cwd: input.selectedRepositoryPath }),
    };
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: "cli",
    cols: 120,
    rows: 32,
    command: "codex",
    args:
      input.launchTarget.type === "resume"
        ? ["resume", "--remote", CodexAppServerListenUrl, input.launchTarget.threadId]
        : ["--remote", CodexAppServerListenUrl],
    ...(input.selectedRepositoryPath === null ? {} : { cwd: input.selectedRepositoryPath }),
  };
}

export function resolveChatRestoreConnectionInput(input: {
  initialCwd: string | null;
  sandboxInstanceId: string;
  durableThreadId: string | null;
}): ChatRestoreConnectionInput {
  if (input.durableThreadId === null) {
    return {
      initialCwd: input.initialCwd,
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: null,
      selectionPolicy: "most_recently_updated",
    };
  }

  return {
    initialCwd: input.initialCwd,
    sandboxInstanceId: input.sandboxInstanceId,
    targetThreadId: input.durableThreadId,
    providerThreadId: input.durableThreadId,
  };
}

type CliRestoreContext = {
  conversationId: string | null;
  initialCwd: string | null;
};

const EmptyCliRestoreContext: CliRestoreContext = {
  conversationId: null,
  initialCwd: null,
};

export function resolveCliRestoreContext(input: {
  fallbackConversationId: string | null;
  launchDirectory: string | null;
  launchTarget: SessionCliLaunchTarget;
  preserveLaunchContext: boolean;
}): CliRestoreContext {
  return {
    conversationId:
      input.preserveLaunchContext && input.launchTarget.type === "resume"
        ? input.launchTarget.threadId
        : input.fallbackConversationId,
    initialCwd: input.preserveLaunchContext ? input.launchDirectory : null,
  };
}

export type {
  ChatRestoreConnectionInput,
  SessionMainPanelHandoffLifecycle,
  SessionMainPanelHandoffRuntime,
  SessionMainPanelRuntimeId,
  SessionMainPanelHandoffResult,
  SessionCliLaunchTarget,
  UseSessionMainPanelHandoffInput,
};

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
  const cliRestoreContextRef = useRef<CliRestoreContext>(EmptyCliRestoreContext);

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
    cliRestoreContextRef.current = EmptyCliRestoreContext;
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

  const getActiveRuntime = useCallback((): SessionMainPanelHandoffRuntime => {
    return input.runtimes[input.activeRuntimeIdRef.current];
  }, [input.activeRuntimeIdRef, input.runtimes]);

  const startChatRestore = useCallback((): void => {
    const generation = nextGeneration();
    const activeRuntime = getActiveRuntime();
    const durableThreadId =
      cliRestoreContextRef.current.conversationId ?? activeRuntime.restoreConversationId;

    restoreGenerationRef.current = generation;
    restoreExecutionGenerationRef.current = null;
    clearRestoreTimeout();
    restoreTimeoutIdRef.current = systemScheduler.schedule(() => {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      failRestore("Timed out while restoring chat.");
    }, ChatRestoreTimeoutMs);
    activeRuntime.lifecycle.clearLifecycleErrorMessage();
    dispatch({
      type: "chat_restore_requested",
    });
    activeRuntime.resetServerRequests();

    void closeAndDisconnectCliPty(input.cliPtyState);

    if (input.sandboxInstanceId === null) {
      failRestore("Could not restore chat because the current session thread is unavailable.");
      return;
    }

    // Restore honors the exact conversation launched into the CLI when known.
    // Otherwise local sessions intentionally reconnect using the most recently
    // updated thread.
    activeRuntime.lifecycle.connectSession(
      resolveChatRestoreConnectionInput({
        initialCwd: cliRestoreContextRef.current.initialCwd,
        sandboxInstanceId: input.sandboxInstanceId,
        durableThreadId,
      }),
    );
  }, [
    clearRestoreTimeout,
    getActiveRuntime,
    input.cliPtyState,
    input.sandboxInstanceId,
    isCurrentGeneration,
    nextGeneration,
  ]);

  const handoffToCli = useCallback(async (): Promise<void> => {
    const activeRuntimeId = input.activeRuntimeIdRef.current;
    const activeRuntime = input.runtimes[activeRuntimeId];
    if (
      input.sandboxInstanceId === null ||
      activeRuntime.lifecycle.sessionSnapshot === null ||
      state.transitionState !== "stable_chat"
    ) {
      return;
    }

    const generation = nextGeneration();
    dispatch({
      type: "handoff_to_cli_requested",
    });

    try {
      const launchTarget = await activeRuntime.resolveCliLaunchTarget();
      if (!isCurrentGeneration(generation)) {
        return;
      }

      const selectedRepositoryPath = input.selectedRepositoryPathRef.current;
      cliRestoreContextRef.current = resolveCliRestoreContext({
        fallbackConversationId: activeRuntime.restoreConversationId,
        launchDirectory: selectedRepositoryPath,
        launchTarget,
        preserveLaunchContext: activeRuntime.preserveCliLaunchForRestore,
      });
      activeRuntime.lifecycle.detachSessionConnection();
      activeRuntime.resetServerRequests();

      await input.cliPtyState.actions.openPty({
        ...buildCliPtyOpenInput({
          launchTarget,
          runtimeId: activeRuntimeId,
          sandboxInstanceId: input.sandboxInstanceId,
          selectedRepositoryPath,
        }),
      });

      if (!isCurrentGeneration(generation)) {
        await closeAndDisconnectCliPty(input.cliPtyState);
        return;
      }

      activeRuntime.clearActiveThreadIdAfterCliLaunch(launchTarget);
      dispatch({
        type: "cli_handoff_succeeded",
      });
    } catch (error) {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      cliRestoreContextRef.current = EmptyCliRestoreContext;
      dispatch({
        type: "cli_handoff_failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : `Could not start ${activeRuntime.displayName} TUI.`,
      });
    }
  }, [
    input.activeRuntimeIdRef,
    input.cliPtyState,
    input.runtimes,
    input.selectedRepositoryPathRef,
    input.sandboxInstanceId,
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

    const activeRuntime = getActiveRuntime();
    if (activeRuntime.lifecycle.lifecycleErrorMessage === null) {
      return;
    }

    if (!isCurrentGeneration(restoreGeneration)) {
      return;
    }

    clearRestoreTimeout();
    failRestore(activeRuntime.lifecycle.lifecycleErrorMessage);
  }, [failRestore, getActiveRuntime, isCurrentGeneration, state.transitionState]);

  useEffect(() => {
    const restoreGeneration = restoreGenerationRef.current;
    if (state.transitionState !== "restoring_chat" || restoreGeneration === null) {
      return;
    }

    const activeRuntime = getActiveRuntime();
    if (activeRuntime.lifecycle.sessionConnectionState !== "connected") {
      return;
    }

    if (
      activeRuntime.lifecycle.sessionSnapshot === null ||
      activeRuntime.lifecycle.sessionSnapshot.activeConversationId === null
    ) {
      return;
    }

    if (restoreExecutionGenerationRef.current === restoreGeneration) {
      return;
    }

    restoreExecutionGenerationRef.current = restoreGeneration;

    void (async () => {
      try {
        await activeRuntime.hydrateChatFromConversation();
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
    getActiveRuntime,
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
